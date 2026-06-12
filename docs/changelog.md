# Changelog — RugFlow ERP

## 2026-06-12 — Bundel-sleutel SQL↔TS-contract met golden fixtures (mig 385)

De bundel-sleutel-familie (`_normaliseer_afleveradres`/`bundel_sleutel`/`verzendweek_voor_datum` ↔ `normaliseer-adres.ts`/`bundel-sleutel.ts`/`verzendweek.ts`) werd alleen door comments in lockstep gehouden. Nu: één golden-fixture-bestand (`frontend/src/lib/orders/__tests__/golden/bundel-sleutel.golden.json`, 21 cases) met twee consumenten — Vitest-contracttest `bundel-sleutel.contract.test.ts` (TS) en `assert_bundel_sleutel_contract()` (SQL, zelf-testende migratie 385, incl. vorm-guard tegen stil-slagende lege case-arrays); een sync-test bewijst dat het `$golden$`-blok in de laatste `*_bundel_sleutel_contract*.sql`-migratie gelijk is aan de JSON. Probe op de live DB (12-06): NBSP en kleine-ß gaven op deze locale toevallig al TS-identieke output, maar hoofdletter-ẞ (U+1E9E) divergeerde bevestigd — en het gedrag was sowieso locale-afhankelijk. `_normaliseer_afleveradres` v2 (mig 385) en `normaliseerAdresKey` (ß/ẞ→ss-fold) zijn nu deterministisch JS-identiek (expliciete whitespace-klasse + chr(223)/chr(7838)-fold). Steekproef: 20 van 1427 open orders dragen zo'n teken in `afl_adres` (DE-straatnamen); sleutels worden nergens gepersisteerd, dus geen datamigratie. Conventie: wijziging aan een van de zes functies = golden bijwerken + nieuwe `*_bundel_sleutel_contract*.sql` met assert-aanroep (sync-test wordt anders rood). Toegepast in de SQL Editor op 12-06 onder werknummer 383 (hernummerd naar 385 wegens collisie met de werkagenda-migraties); na-verificatie via live probe geslaagd, incl. de ẞ-case.
## 2026-06-12 — Werkagenda-config centraal (mig 384, fase 2)

Werktijden + vrije dagen verhuisd van per-browser-localStorage naar
`app_config 'werkagenda'`. UI (productie-instellingen, snijplanning-agenda),
`check-levertijd`/`spoed-check` (edge) en de Pick & Ship-dag-order-horizon
lezen nu dezelfde kalender — een feestdag invoeren landt één keer en telt
overal. `volgendeWerkdag`/`naarWerkdag` (levertijd-match) lopen nu ook via
kernel-`isWerkdag` i.p.v. hardcoded za/zo. Eenmalige best-effort-overname van
bestaande localStorage-instellingen (alleen als de DB-rij nog default is).

## 2026-06-12 — Werkagenda: één bron (kernel-consolidatie, mig 383)

De werkdag-/werkagenda-rekenkunde leefde op drie plekken: SQL (mig 279 — nul
callers, dode code), Deno `_shared/werkagenda.ts` (UTC, geen feestdagen) en
frontend `bereken-agenda.ts` (lokale tijd, wél feestdagen) — met al-uiteengelopen
interfaces, ~24u verschil in `teLaat`-semantiek en andere sortering.
Geconsolideerd: `_shared/werkagenda.ts` is nu de enige implementatie (rijke
interface met 'HH:mm' + `vrij`-feestdagen); de frontend importeert de kernel
direct (derive-status-patroon, vite `server.fs.allow`); golden fixture
`werkagenda.golden.json` wordt door Deno én Vitest getoetst; de dode SQL is
gedropt (mig 383). `teLaat` is geünificeerd op strikt (00:00-deadline) — de
UI-agenda en check-levertijd geven nu dezelfde vlag. Sorterings-verschil
berekenAgenda↔berekenSnijAgenda blijft bewust staan (B6, kernel-header).

## 2026-06-12 — Rhenus als transporteur: GS1-XML via SFTP (ADR-0032, mig 379-382) — gebouwd, rondreis geslaagd

> **Hernummering:** de Rhenus-migraties zijn vlak vóór de merge hernummerd van 378-381 naar **379-382** (origin/main bleek een eigen 378 te hebben — `klant_omzet_ytd_prijslijst`). In de live DB zijn ze onder de óúde bestandsnamen toegepast; inhoudelijk identiek.

**Aanleiding:** mails Rhenus → Piet-Hein (12-06): SFTP-gegevens compleet (`sedi.de.rhenus.com`, user `Karpi`, /in-map + testmap; wachtwoord apart gemaild — alleen als secret, nooit in de repo) én een foutmelding over legacy-bericht `0455395` (`totalPackageQuantity=0` zonder item-segmenten → error bij Rhenus; daar handmatig hersteld). Rhenus-cutover staat gepland voor week 24 (= deze week).

**Gebouwd (branch `feat/rhenus-transporteur`, gestapeld op `feat/verhoek-transporteur`):**
- **ADR-0032:** Rhenus via GS1 TransportInstruction-XML ("RHE" 3.1, SBDH) over SFTP — derde vervoerder-adapter naar het Verhoek-patroon. Legacy-referentie-excerpt + toelichting in `docs/rhenus/voorbeelden/`.
- **Mig 374-amendement (cascade-fix):** de live DB bleek selectie-regels te hebben die naar de placeholders wijzen (Verhoek NL ≥27 kg / DE ≥30 kg; Rhenus DE ≤30 kg + debiteur-pins). De guarded `DELETE edi_partner_b` in mig 374 cascadeert naar die regels → ze zouden bij apply stilletjes verdwijnen. Fix: regels eerst omhangen naar `verhoek_sftp`, dán de delete. **Apply mig 374 dus vanaf deze branch.**
- **Mig 379:** vervoerder `rhenus_sftp` (type `'sftp'`, `actief=FALSE`), selectie-regels `edi_partner_a`→`rhenus_sftp` omgehangen, placeholder guarded verwijderd, `app_config 'rhenus'` geseed (`sscc_met_00_prefix`/`package_type_code`/`bestandsnaam_prefix`).
- **Mig 380:** `rhenus_transportorders` + enum + 5 RPC's + reaper + `rhenus_verzend_monitor`; dispatch-case `WHEN 'rhenus_sftp'` in de `'sftp'`-tak van `enqueue_zending_naar_vervoerder`.
- **Mig 381:** cron `rhenus-send-elke-minuut` (veilig: lege wachtrij zolang inactief + dry-run-default).
- **`_shared/sftp-client.ts`:** verplaatst uit `verhoek-send` (pure move; verhoek-send/spike importeren uit de seam). Orchestrator-loop bewust opnieuw gespiegeld — generalisatie over 3 adapters = backlog (cutover-week).
- **`rhenus-send`:** pure `xml-builder.ts` (12 unit-tests; kg-formattering legacy-conform, escaping, planned-dates met trailing `T`, Freetext `Order <nr> Ref <klant_referentie>`) + orchestrator met dry-run-default, bestandsnaam-dedup vóór upload, audit via `externe_payloads` kanaal `'rhenus'`, XML-kopie in `rhenus-xml/`. **0-colli driedubbel geblokkeerd** (validator + preflight + builder-throw — incident 0455395 kan uit ons systeem niet meer ontstaan).
- **`vervoerder-eisen`-seam:** `rhenus_sftp` deelt de SFTP-eisen (adresvelden verplicht; telefoon/land niet) — shared + frontend-spiegel + tests.
- **`rhenus-sftp-spike`** (wegwerp): verbindings-/upload-test met de `RHENUS_SFTP_*`-secrets; uploadt met `.xml.test`-extensie zodat een per ongeluk op /in gerichte spike niet als echte instructie verwerkt wordt.

**Verificatie:** 32 deno-tests groen (rhenus + verhoek + shared), `deno check` op alle nieuwe entrypoints, frontend `npm run typecheck` groen.

**Voortgang later op 12-06 (alles uitgevoerd):** migraties toegepast (geverifieerd: regels omgehangen zonder verlies, placeholders weg, config + monitors live); alle vier de functions gedeployed (`rhenus-send`/`rhenus-sftp-spike`/`verhoek-send`/`verhoek-sftp-spike`). **Interne dry-run-rondreis geslaagd:** happy path ZEND-2026-0004 → `Verstuurd` (dry-run) met legacy-conforme XML (land `NEDERLAND`→`NL`, SSCC 00-prefix, kg-decimalen, Freetext `Order ORD-2026-0005 Ref 7200438517`) + `externe_payloads`-rij; fout-pad ZEND-2026-0001 (gewicht 0) → `Fout` na 3 retries met heldere `Pre-flight:`-reden. **Bevinding → mig 382:** de best-effort XML-kopie naar storage faalde op 415 `invalid_mime_type` — de `order-documenten`-allowlist (mig 178) kent geen XML; mig 382 voegt `application/xml`+`text/xml` toe (raakt ook verhoek-send). **Secrets vereisen owner/admin-rechten** ("account does not have the necessary privileges" op Miguels account) — Piet-Hein heeft `RHENUS_SFTP_*` + `RHENUS_DRY_RUN=false` + `RHENUS_SFTP_REMOTE_DIR=/test` gezet. **Échte rondreis geslaagd:** `rhenus-send` uploadde via de edge-runtime (= ssh2-runtime-bewijs) `RHE_20260612145904_ZEND-2026-0004.xml` naar Rhenus' `/test`-map; onafhankelijk geverifieerd via SFTP-listing (3170 bytes; servermappen: `in`/`out`/`test`/`dev`). Testmail naar Rhenus verstuurd (format-check + vraag over alfanumerieke entityIdentification / 1-bestand-per-zending / bestandsnaam-conventie). **Frontend:** vervoerder-registry + zendingen-filter omgezet van de mig 170-placeholdercodes naar `rhenus_sftp`/`verhoek_sftp` (pills kregen anders grijze fallback); inactieve vervoerders waren al zichtbaar-maar-disabled ("inactief") in beide selectors — Rhenus is dus zichtbaar maar niet selecteerbaar tot de cutover.

**Nog open (na Rhenus' format-akkoord):** `RHENUS_SFTP_REMOTE_DIR=/in` (Piet-Hein) + `UPDATE vervoerders SET actief=TRUE WHERE code='rhenus_sftp'` = cutover. **Vóór echte verzending:** gewicht-datagap (`zending_colli.gewicht_kg` vrijwel overal 0) oplossen — preflight blokkeert terecht. Geen heraanlevering van bericht 0455395 nodig (door Rhenus handmatig verwerkt).

## 2026-06-12 — Verzendlabel-SSCC uit `zending_colli`: label = HST-aanmelding (overlossing-incident)

**Incident:** HST meldde 3 karpetten (ZEND-2026-0001/0002/0003) als "overlossing — geen data" ondanks geslaagde transportorder-aanmeldingen (T75038267000181/182/183, HTTP 201). Oorzaak: twee onafhankelijke SSCC-generatoren. De geprinte labels kregen hun barcode van de client-side `generateSscc(zendingId, colliIndex)` (`lib/sscc.ts`, 1 mei), terwijl `hst-send` de DB-SSCC's uit `zending_colli` (sequence `genereer_sscc()`, mig 209, 7 mei) aanmeldde met `HasBarcode: true` — twee bronnen die nooit gekoppeld zijn geweest. HST scant het label → onbekende barcode → geen match.

**Fix (frontend-only, geen migratie):**
- `fetchZendingPrintSet` fetcht `zending_colli (id, colli_nr, sscc, order_regel_id)` mee; nieuw interface `ZendingPrintColli`.
- `expandLabels` (`lib/printset.ts`) bouwt labels uit de colli-rijen (gesorteerd op `colli_nr`, regel-koppeling via `order_regel_id`) — de SSCC komt verbatim uit de DB, exact dezelfde rijen als de HST-aanmelding. Legacy-zendingen zonder colli-rijen krijgen labels zónder barcode (`sscc: null`): een niet-aangemelde barcode mag nooit geprint worden.
- Client-side generator `lib/sscc.ts` verwijderd — de fout-klasse kan niet terugkomen.
- Label-componenten (`shipping-label`, `shipping-label-tall`, `dpd-shipping-label`) accepteren `sscc: string | null` en tonen "Geen colli-barcode geregistreerd" bij null.
- Vangnet: `lib/printset.test.ts`, incl. expliciete regressietest dat de oude generator-waarde (zending 28/colli 1 → `…2810`) nooit meer kan verschijnen.

**Operationeel (lopende zendingen):** HST koppelt de drie karpetten handmatig via de mapping label-barcode → T&T: `00087159540000002612` → T75038267000181 (Clark, Lijnden), `00087159540000002711` → T75038267000183 (Van Duffelen, 's-Gravenhage), `00087159540000002810` → T75038267000182 (Ten Velde, Bennebroek).

## 2026-06-12 — DESADV-verzendbevestiging LIVE: format gevalideerd + cron actief (slice 4 afgerond)

**Activatie voltooid (12-06):** format-builder byte-identiek gevalideerd tegen écht Hornbach-bericht 172390327 (bronbestand + EDIFACT-paar in `docs/transus/voorbeelden/`, kolomkaart in `karpi-verzendbericht.ts`); test-renders van orders ORD-2026-0334 (Hornbach) en ORD-2026-0232 (BDSK, 10 regels) door Miguel goedgekeurd in Transus' Testen-tab; `bouw-verzendbericht-edi` gedeployed (`--no-verify-jwt`, auth via `?token=` zoals transus-send); **migratie 377 toegepast — cron `verzendbericht-edi-sweep` draait (jobid 12, */15 min)**. Er waren op activatiemoment 0 verzonden EDI-orders; de eerste echte verzending van een Hornbach/BDSK-order produceert automatisch de eerste DESADV (zichtbaar in de Communicatie-tijdlijn + EDI-module). **Bugfix tijdens activatie:** kale PostgREST-embeds `debiteuren(naam)` en `producten(ean_code)` gaven PGRST201 (dubbele FK-relaties: `betaler`-FK resp. `fysiek_artikelnr`-FK mig 154) — expliciete FK-hints toegevoegd; DESADV toont het originele artikel (omsticker intern, zelfde regel als factuur).

## 2026-06-11 — DESADV-verzendbevestiging via EDI: infra gebouwd (slice 4)

**Wat:** de infra voor automatisch versturen van DESADV-verzendberichten (verzendbericht/pakbon) via Transus is gebouwd. De format-builder gooide bewust een fout totdat het Transus-format gevalideerd was (Taak 12-STOP — opgelost op 12-06, zie entry hierboven).

**Gebouwd:**
- `supabase/functions/_shared/transus-formats/karpi-verzendbericht.ts` (+test): bevroren input-interface `VerzendberichtInput` + `valideerVerzendberichtInput`; `buildKarpiVerzendbericht` gooit bewust een `Error('DESADV-format nog niet gevalideerd')` tot Taak 12 afgerond is.
- Edge function `supabase/functions/bouw-verzendbericht-edi/index.ts` (spiegelt `bouw-factuur-edi`): POST `{order_id}` (gericht) of `{}` (sweep over `status='Verzonden' AND bron_systeem='edi'` met partners waarbij `verzend_uit && transus_actief`, minus al-bestaande verzendberichten). Sweep-venster: alleen `verzonden_at >= now() - 7 dagen` — historische orders worden bij activatie niet alsnog verzonden; gerichte POST omzeilt het venster bewust. Idempotent op `(richting='uit', berichttype='verzendbericht', bron_tabel='orders', bron_id)`. Klant-PO uit `orders.klant_referentie`; zending via `zending_orders → zendingen(zending_nr, verzenddatum, track_trace)`; GTIN uit `producten.ean_code` (admin-pseudo/VERZEND-regels gefilterd — fysiek document); GLN's uit order-snapshots. Verstuurd door bestaande cron `transus-send` (mig 305).
- `supabase/config.toml`: `[functions.bouw-verzendbericht-edi] verify_jwt = false`.
- `supabase/migrations/377_verzendbericht_edi_cron.sql`: pg_cron-sweep elke 15 min — **NOG NIET TOEGEPAST** (builder gooit tot format-validatie klaar is). (Driemaal hernummerd: 372→373→374→377 wegens collisies met origin/main en `feat/verhoek-transporteur` (374-376).)
- Verschijnt automatisch in de Communicatie-tijdlijn op order-detail (slice 3, label 'Verzendbevestiging') — geen extra UI nodig.
- Partners die hierop wachten: Hornbach NL (361208) en BDSK (600556) — `verzend_uit` staat daar al aan.

**Activatievolgorde (mens-stappen, in deze volgorde):**
1. **Taak 12:** Miguel downloadt een historisch verzendbericht/pakbon-voorbeeld uit Transus Online (Handelspartners → proces "Pakbon/Verzendbericht versturen" → Bekijken en testen → bestand downloaden, bij voorkeur BDSK of Hornbach), plaatst het in `docs/transus/voorbeelden/`, daarna wordt het format gereverse-engineered + fixture-test + `buildKarpiVerzendbericht` geïmplementeerd, en gevalideerd in Transus' Testen-tab (recept `docs/transus/demo-rondreis.md`).
2. **Deploy:** `supabase functions deploy bouw-verzendbericht-edi --project-ref wqzeevfobwauxkalagtn`.
3. **Gerichte test:** POST met één order_id van een verzonden Hornbach/BDSK-order; wachtrij-rij controleren; `transus-send` laten versturen; ontvangst bij partner verifiëren.
4. **Migratie 377 toepassen** (cron aan).

## 2026-06-11 — Communicatie-tijdlijn: EDI-berichten naast e-mails op order-detail (slice 3)

**Wat:** de "E-mails"-sectie op order-detail heet nu "Communicatie" en toont in één gecombineerde tijdlijn zowel verstuurde e-mails als uitgaande EDI-berichten (`edi_berichten richting='uit'`). EDI-items tonen type (orderbev/factuur/verzendbericht), live status (Wachtrij/Verstuurd/Fout met kleurcodering) en een directe link naar het EDI-bericht-detail (`/edi/berichten/:id`). E-mail-items renderen exact als voorheen (klik opent dialog).

**Technisch:**
- Pure merge-helper `communicatie-tijdlijn.ts` (`bouwCommunicatieTijdlijn`) — testbaar zonder Supabase, bewust géén logica in de component.
- Nieuwe query `fetchUitgaandeEdiBerichtenVoorOrder` (`@/modules/edi`) — haalt `id, berichttype, status, is_test, sent_at, created_at` op; geen payload-velden (zwaar).
- `order-emails.tsx` laadt via `useQuery` de EDI-berichten parallel aan de bestaande e-mailhook; wacht op beide `isLoading`-flags voor render.

**Ontwerp-keuze (géén dubbel-loggen):** `verstuurde_emails` en `edi_berichten` blijven elk hun eigen bron-van-waarheid; de merge is puur presentatie. EDI-facturen die via `edi_handelspartner_config` gestuurd worden, verschijnen als EDI-rij — niet als e-mailrij — conform de slice-2-gate.
- **Bekende beperking bundel-facturen:** de EDI-INVOIC hangt aan één order (`edi_berichten.order_id` = eerste order van de bundel); op de tijdlijn van de overige bundel-orders is de factuur niet zichtbaar (de e-mail-variant logde wél per order). Eventuele match op `factuur_id` staat op de backlog.

## 2026-06-11 — Factuur: e-mail onderdrukt bij actieve EDI-INVOIC (slice 2)

**Wat:** mail-gate `!ediFactuurActief` toegevoegd aan het e-mailblok in `factuur-verzenden` (stap 7); `verstuurd_naar` logt nu `'EDI Transus'` i.p.v. een e-mailadres dat nooit gemaild is. De `logVerstuurdeEmails`-aanroepen zitten al binnen het gated blok — geen aparte aanpassing nodig. De PDF blijft altijd in storage.

**Waarom:** debiteuren met `edi_handelspartner_config.transus_actief && factuur_uit` kregen de factuur zowel via EDI-INVOIC (stap 6) als per e-mail (stap 7) — dubbel kanaal in strijd met de partner-afspraak "EDI-only". `verstuurd_naar` registreerde vervolgens het e-mailadres alsof er gemaild was.

## 2026-06-11 — Universele bevestig-knop: kanaal-dispatch EDI vs e-mail

**Aanleiding:** EDI-orders kregen nul orderbevestigingen na de EDI-cutover van 3 juni — de "Bevestig order"-knop stuurde altijd e-mail, ook bij EDI-orders. Bovendien werd de `orderbev_uit`-toggle in `edi_handelspartner_config` nergens gecheckt, waardoor partners die géén orderbev willen (SB Möbel BOSS 150761, Hammer 330955) er toch een kregen. Ontwerp-besluit (bijgesteld dezelfde dag, zie onderaan deze entry): het kanaal hangt aan de order (`bron_systeem`) én per documenttype aan de partnerconfig — wat de partner via EDI wil, gaat via EDI; al het andere gewoon per e-mail.

- **`bepaalBevestigingKanaal` + `isOrderBevestigd`** ([`bevestiging-kanaal.ts`](../frontend/src/lib/orders/bevestiging-kanaal.ts)): pure dispatcher — `bron_systeem='edi'` + `transus_actief && orderbev_uit` → `'edi'`; alle andere orders (ook EDI-orders zonder actieve EDI-orderbev) → `'email'`. Optioneel `kanaal`-param in `isOrderBevestigd`: met `'edi'` → `edi_bevestigd_op`; met `'email'` → `bevestigd_at`; zonder → oud fallback-gedrag.
- **`bevestigOrderZonderEdiBericht`** ([`bevestig-helper.ts`](../frontend/src/modules/edi/lib/bevestig-helper.ts)): zet de `edi_bevestigd_op`-gate via RPC `markeer_order_edi_bevestigd` — hergebruikt voor het administratieve deel van de leverweek-bevestiging bij email-kanaal EDI-orders.
- **Gedeelde hook `useBevestigEdiOrder`** ([`use-bevestig-edi-order.ts`](../frontend/src/modules/edi/lib/use-bevestig-edi-order.ts)): gedeeld door het amber leverweek-paneel (`edi-leverweek-bevestigen.tsx`) én de nieuwe `BevestigOrderEdiDialog`; laadt `edi_handelspartner_config` en bepaalt het kanaal.
- **`BevestigOrderEdiDialog`** ([`bevestig-order-edi-dialog.tsx`](../frontend/src/components/orders/bevestig-order-edi-dialog.tsx)): uitsluitend bereikbaar bij kanaal `'edi'` — leverweek kiezen, geen e-mailveld; ORDRSP op `edi_berichten`-wachtrij → `transus-send`.
- **Kanaal-dispatch in `order-header.tsx`**: groene knop opent bij kanaal `'edi'` de EDI-dialog, bij kanaal `'email'` de e-maildialog (ook voor EDI-orders zonder actieve EDI-orderbev); "Opnieuw versturen" ook voor email-kanaal EDI-orders; button disabled tijdens config-laden.
- **`BevestigOrderDialog` met `sluitEdiGate`** ([`bevestig-order-dialog.tsx`](../frontend/src/components/orders/bevestig-order-dialog.tsx)): nieuwe optionele prop — na succesvolle mail sluit ook de `edi_bevestigd_op`-gate (best-effort) zodat het "Te bevestigen"-chip en het amber paneel verdwijnen.

**Bijgesteld besluit (11-06, Miguel):** wat een partner niet via EDI wil ontvangen, gaat automatisch per e-mail — kanaal `'edi_stil'` vervangen door `'email'`-fallback; na succesvolle mail sluit ook de EDI-leverweek-gate.

## 2026-06-12 — Pick & Ship: geblokkeerde orders naar eigen sectie ónder de week-secties (branch `fix/pick-geblokkeerd-onderaan`)

**Correctie op de sorteer-fix van vanochtend (zie entry hieronder):** de
binnen-sectie-sortering loste het probleem niet op — de "Geen vervoerder
mogelijk"-orders hebben oude verzendweken en vormden dus **complete
"Achterstallig"-secties die als geheel bovenaan de tab stonden**. Miguel:
"alle die niet verzonden kunnen worden staan bovenaan in de week."

**Fix:** geblokkeerde orders gaan helemaal niet meer de week-/dag-secties in.
[`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)
splitst `naVervoerderFilter` in startbaar vs. geblokkeerd (predicaat ongewijzigd:
≥1 regel `bron='geen'`, niet-afhalen); de week-secties tonen alleen startbare
orders en nieuwe component
[`PickGeblokkeerdSectie`](../frontend/src/modules/magazijn/components/pick-geblokkeerd-sectie.tsx)
(amber, Ban-icoon, zelfde klant-clustering + land-toggle) rendert de
geblokkeerde orders als laatste sectie. Week-sectie-tellingen tellen ze niet
meer mee; de week-tab-badges (stats) wél — ze zitten nog in de tab. Zodra een
vervoerder geactiveerd of een override gezet is verhuist de order vanzelf
terug naar zijn week-sectie. De sorteer-props op PickWeekSectie/
PickDagOrdersSectie (vanochtend) zijn weer verwijderd; de
`geblokkeerdeOrderIds`-parameter op de `groeperen.ts`-helpers blijft (getest,
defense-in-depth). Puur UI — geen DB-wijziging.

**Verzoek Miguel:** orders die gepickt kunnen worden moeten boven de
"Geen vervoerder mogelijk"-orders staan. `clusterOrdersOpKlant` /
`groepeerOrdersOpLand` ([`groeperen.ts`](../frontend/src/modules/magazijn/lib/groeperen.ts))
accepteren nu een optionele `geblokkeerdeOrderIds`-set als primaire sorteersleutel
(geblokkeerd → achteraan, daarbinnen ongewijzigd alfabetisch op klant + order_nr;
binnen een bundel-cluster zakken geblokkeerde orders ook naar onder).
[`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)
voedt de set uit de al aanwezige per-order vervoerder-queries (zelfde predicaat
als `StartPickrondesButton` + mig 373-guard: ≥1 regel `bron='geen'`, niet-afhalen)
en geeft hem door aan beide secties (week + dag-orders). Puur UI-sortering —
geen DB-wijziging. Tests: 3 nieuwe cases in `groeperen.test.ts`.

## 2026-06-11 — Pick & Ship toonde maar 91 van ~236 pickbare orders (PostgREST-cap) + pick-start geblokkeerd zonder vervoerder (mig 373, branch `fix/pick-ship-zonder-vervoerder`)

**Verzoek Miguel (vervolg op mig 372):** "Zet ze [orders zonder vervoerder]
wel allemaal tussen de pick lijst, maar blokkeer het starten van het picken
door 'geen vervoerder mogelijk'." Bij het onderzoek bleek een **echte bug**
de orders te verbergen — niet de vervoerder-status:

1. **PostgREST max-rows-cap (1000) at orders stilletjes op.**
   `fetchPickbaarheidRegels` ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts))
   haalde de héle `orderregel_pickbaarheid`-view op zonder `order_id`-filter.
   De view heeft inmiddels 2068 rijen (EDI-instroom juni); de kale GET gaf er
   maar 1000 terug. Orders waarvan de regels buiten die eerste 1000 vielen
   kregen `regels.length === 0` → het pickbaarheidsfilter gooide ze weg.
   Resultaat: 91 zichtbaar van ~236 pickbare orders, zonder enige fout.
   **Fix:** gechunkt ophalen per `order_id` (100 per chunk, zelfde patroon als
   de fallback). Incidentklasse om te onthouden: een PostgREST-GET zonder
   filter op een groeiende view is een tijdbom — de cap knipt geruisloos.
2. **Pick-start zonder vervoerder geblokkeerd, dubbel:**
   - **Frontend** ([`start-pickrondes-button.tsx`](../frontend/src/modules/logistiek/components/start-pickrondes-button.tsx)):
     per order de effectieve vervoerder geresolved (zelfde queryKey als de
     pick-card-tag → cache-hit); orders met ≥1 regel `bron='geen'` tellen
     niet mee als startbaar. Solo-kaart toont disabled knop **"Geen
     vervoerder mogelijk"**; bundel-tooltip telt ze als overgeslagen.
   - **Server** (mig 373): `start_pickronden` (body = mig 258 + guard)
     weigert elke niet-afhaal-order met ≥1 regel `bron='geen'` met dezelfde
     melding. Voorkomt zendingen met `vervoerder_code=NULL` die na voltooien
     nergens heen kunnen. Escape-hatch: vervoerder-override op de orderregel
     (bron wordt 'override') voor bewuste uitzonderingen.

Met de cap-fix verschijnen de ~159 DE/BE-orders (zie mig 372-entry) nu wél in
Pick & Ship; hun Verzendset-knop is geblokkeerd totdat Rhenus/DPD geactiveerd
zijn (Rhenus gepland deze week) of een handmatige vervoerder gekozen is.

**Toepassen:** mig 373 in de Supabase SQL-editor draaien.

## 2026-06-11 — "196 orders zonder vervoerder"-banner geduid: uitsplitsing per land + scope-uitleg (mig 372, branch `fix/zonder-vervoerder-banner`)

**Melding Miguel:** de amber banner op Pick & Ship zei "196 order(s) zonder
vervoerder" terwijl het scherm maar 91 orders toonde — "volgens mij gaat er
iets fout". **Diagnose: de telling klopt, de presentatie misleidde.** De view
`orders_zonder_vervoerder` (mig 338/345) telt bewust álle open orders (ook
`Wacht op voorraad/inkoop/maatwerk`, die Pick & Ship verbergt). De 196 waren
op dat moment: 183× DE + 13× BE (179 EDI-orders, instroom 3–11 juni), 0× NL.
Oorzaak dat ze geen vervoerder krijgen: alle DE/BE-vervoerders
(`dpd`/`edi_partner_a`/`edi_partner_b`) staan tot hun cutover op
`actief=false` — de resolver (mig 225) slaat regels van inactieve vervoerders
over, en alleen `hst_api` (NL) is live. Dat is conform ADR-0030, maar de
banner ("kies handmatig") suggereerde een handmatige actie op 196 orders.

**Belangrijke non-bug:** `afl_land='DEUTSCHLAND'`/`'BELGIË'` (vol uitgeschreven,
102 orders) leek een match-probleem maar is het niet — `matcht_regel`
normaliseert sinds mig 214 beide zijden via `normaliseer_land`. Bewust **niet**
gebackfilld naar ISO-codes: `trg_lock_zending_bundel_sleutel` blokkeert
afl_*-mutaties op orders in actieve bundels, en gemengde spelling zou juist
de adres-bundeling (mig 222, exacte string-match) tussen oude en nieuwe orders
breken.

**Fix (mig 372 + frontend):**
- View krijgt twee extra kolommen: `status` (TEXT) en `afl_land_norm`
  (via `normaliseer_land`). Scope bewust ongewijzigd.
- [`hst-monitor.ts`](../frontend/src/modules/logistiek/queries/hst-monitor.ts):
  `countOrdersZonderVervoerder` → `fetchOrdersZonderVervoerder` + pure
  aggregator `vatZonderVervoerderSamen` (totaal, per-land, waarvan klaar voor
  picken). `select('*')` zodat de frontend ook op de pre-mig-372-view blijft
  werken (dan zonder status-uitsplitsing).
- [`hst-aandacht-banner.tsx`](../frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx):
  toont nu "X open order(s) zonder vervoerder — 183× DE, 13× BE · waarvan 159
  klaar voor picken", legt uit dat over álle open orders geteld wordt, en linkt
  naar `/logistiek/vervoerders`.

**Open beslispunt (Miguel):** DE/BE-verzending — DPD/Rhenus activeren (dan
lossen de bestaande selectie-regels het gros op) of deze orders blijven
handmatig bedienen. Tot die keuze blijft de banner deze aantallen tonen.

**Toepassen:** mig 372 in de Supabase SQL-editor draaien (idempotent,
alleen view + comment).

## 2026-06-11 — BTW verlegd intracommunautair (mig 371)
Duitse (en alle EU-verlegd-)klanten kregen 21% BTW op factuur en orderbevestiging terwijl `debiteuren.btw_verlegd_intracom` al correct stond (verzoek Marjon). De vlag is nu bron van waarheid: SQL-helper `effectief_btw_pct` + TS-seam `_shared/btw.ts`, snapshot `facturen.btw_verlegd`, factuur-PDF en orderbevestiging (mail + PDF, 4-talig) tonen "BTW verlegd" + btw-nr afnemer i.p.v. een BTW-regel. UI: verlegd-toggle op klant-facturering-tab. Geen data-update nodig; bestaande facturen (3) waren niet fout.

## 2026-06-11 — Orderbevestiging pakte factuur-e-mailadres + order-bewerken wiste e-mail-snapshots (branch `fix/orderbevestiging-email-ladder`)

**Melding Marjon (klant 803741, ORD-2026-0349/0350):** "als ik de order wil
bevestigen pakt hij het factuuradres (zr-pdf@einrichtungspartnerring.com)…
Voor mijn gevoel heb ik het wel veranderd naar orderbevestiging@trendhopperbreda.nl."
Diagnose via `verstuurde_emails`-log: haar handmatige correcties kwamen wél
goed aan, maar er zaten vier losse fouten achter:

1. **Order-bewerken wiste `fact_email`/`afl_email`** —
   [`order-edit.tsx`](../frontend/src/pages/orders/order-edit.tsx) gaf beide
   mig 364-snapshots niet mee in de initiële header, waarna
   `update_order_with_lines` ze op NULL zette (zelfde incidentklasse als
   mig 343/368: nieuw veld niet in álle paden). ORD-2026-0350 verloor zo zijn
   factuur-e-mailadres. Fix: velden meegeven in de edit-header.
2. **Edit-mode kende de klant-e-mails niet** — het sync-effect in
   [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) nam
   alleen `prijslijst_nr`/`korting_pct` over uit het asynchroon geladen
   `clientData`; bij een adreswissel viel de `afl_email`-ladder daardoor terug
   op de stale form-waarde. Fix: ook `email_factuur`/`email_overig`/
   `email_verzend` syncen.
3. **Bevestig-dialog prefillde het factuuradres** — de ladder was
   `bevestiging_email ?? klant_email` waarbij `klant_email` =
   `email_factuur ?? email_overig`. Nieuw veld `klant_email_orderbev`
   (`email_overig ?? email_factuur`) in
   [`orders.ts`](../frontend/src/lib/supabase/queries/orders.ts) voedt de
   prefill in [`order-header.tsx`](../frontend/src/components/orders/order-header.tsx);
   `klant_email` zelf blijft ongewijzigd (voedt de dropship-check). Bewust ook
   geen `afl_email` in deze ladder: bij dropship is dat het consument-adres.
   Edge function [`stuur-orderbevestiging`](../supabase/functions/stuur-orderbevestiging/index.ts)
   kreeg dezelfde flip in de fallback (`email_overig` eerst) — die fallback
   vuurt alleen als de dialog leeg verstuurd wordt.
4. **`AddressSelector` auto-selecteerde bij mount óók in edit-mode** het
   eerste afleveradres en overschreef daarmee het opgeslagen order-adres
   (incl. `afl_email`) nog vóór de gebruiker iets deed. Nieuwe prop
   `autoSelect` (FALSE in edit-mode) in
   [`address-selector.tsx`](../frontend/src/components/orders/address-selector.tsx).

**Data-hotfix (live):** ORD-2026-0350 `afl_email` →
orderbevestiging@trendhopperbreda.nl, `fact_email` → zr-pdf@… hersteld;
`afleveradressen` id 6805 (ETTENSEBAAN, het factuuradres) droeg het
factuur-e-mailadres als adres-e-mail → geleegd zodat de ladder voortaan op
klant-niveau (`email_verzend`/`email_overig`) uitvalt. Naveeg (zelfde dag,
mig 367/368-ladder, alleen-vullen-waar-leeg): ook ORD-2026-0152/0305/0343/
0347/0352 hadden door de edit-bug lege snapshots → hersteld en geverifieerd.
De ~46 overige open orders met lege snapshots zijn klanten zónder enig
e-mailadres op de klantkaart — daar is niets te vullen (conform de
migratie-backfill); script: `scripts/_tmp_hotfix_orderbev_email.mjs`.

## 2026-06-11 — Verhoek-transporteur Fase 1: AA2.0-XML via SFTP (ADR-0031, mig 374-376)

**Aanleiding:** Verhoek Europe (tweede vervoerder naast HST) levert niet via Transus-EDI maar via hun eigen XML-formaat "XMLstandardVerhoekEuropeAA20" (AA2.0) over SFTP. Mig 170's placeholder `edi_partner_b` (type `'edi'`) was daarvoor niet geschikt.

**Wat er gebouwd is (code compleet, wacht op apply/deploy/rondreis):**

- **Mig 374** — Nieuw vervoerder-type `'sftp'` (CHECK-constraint uitgebreid); nieuwe vervoerder-rij `verhoek_sftp` (`actief=FALSE` tot rondreis-test geslaagd); `edi_partner_b`-placeholder guarded verwijderd; runtime-config `app_config` sleutel `'verhoek'` (opdrachtgever_nummer, scancode_met_00_prefix, verpakkingseenheid, levering, soort_levering) — antwoorden van Verhoek = SQL-UPDATE, géén redeploy.
- **Mig 375** — Adapter-tabel `verhoek_transportorders` + enum `verhoek_transportorder_status` (Wachtrij/Bezig/Verstuurd/Fout/Geannuleerd) + 5 RPC's (`enqueue_verhoek_transportorder`, `claim_volgende_verhoek_transportorder`, `markeer_verhoek_verstuurd`, `markeer_verhoek_fout`, `herstel_vastgelopen_verhoek`); view `verhoek_verzend_monitor` (cron-health-signaal analoog aan `hst_verzend_monitor`); `WHEN 'sftp'`-tak in `enqueue_zending_naar_vervoerder`.
- **Mig 376** — pg_cron `verhoek-send-elke-minuut` (hergebruikt vault-secret `cron_token`).
- **Edge function `verhoek-send`** — orchestrator-loop (claim → valideer → bouw XML → upload SFTP → markeer); pure `xml-builder.ts` (AA2.0, ScanCode = label-barcode `'00'+SSCC`, Gewicht in decagram, Lengte/Breedte in hele cm); `sftp-client.ts` (SFTP via `npm:ssh2-sftp-client@11` onder Deno Node-compatibiliteit; `test.rebex.net` is de publieke test-server voor de runtime-spike, geen Verhoek-credentials nodig); pre-flight via `vervoerder-eisen.ts`-seam (adresvelden verplicht; telefoon/land niet verplicht voor Verhoek); colli-preflight via `xml-builder.ts` `valideerVerhoekColli` (SSCC, lengte/breedte cm, gewicht_kg — ontbrekende velden → rij op `Fout` met `Pre-flight:`-reden, geen upload); audit via `externe_payloads` kanaal `'verhoek'` + XML-kopie in storage `order-documenten/verhoek-xml/`. Bestandsnaam `Karpi_<timestamp>_<zending_nr>.xml` is de dedup-sleutel bij Verhoek en wordt persisteerd vóór de SFTP-upload zodat retries dezelfde naam hergebruiken.
- **Edge function `verhoek-sftp-spike`** — standalone rebex-runtime-spike tegen publieke test-SFTP-server; faalt de runtime → fallback n8n/Python-worker leegt dezelfde wachtrij.
- **`_shared/adres-split.ts`** — `splitAdres`/`normalizeCountry` geëxtraheerd uit `hst-send` (gedragsneutraal); `hst-send` importeert voortaan uit de seam.
- **`_shared/vervoerder-eisen.ts`** — `verhoek_sftp`-tak toegevoegd (adresvelden verplicht; telefoon/land niet verplicht voor Verhoek); `valideerVerhoekColli` in `xml-builder.ts` valideert SSCC, lengte/breedte cm, gewicht_kg → decagram.

**Status:** Code compleet + getest (unit tests groen). De volgende acties staan open en worden door Miguel uitgevoerd:
1. Mig 374/375/376 apply'en op de live database.
2. Edge functions `verhoek-send` en `verhoek-sftp-spike` deployen.
3. Rebex-runtime-spike draaien (publieke test-SFTP).
4. Interne dry-run-rondreis: `VERHOEK_DRY_RUN=true` (default aan), geen echte SFTP-upload.

**Bekende datagap:** `zending_colli.gewicht_kg` is NULL bij bestaande zendingen → preflight `valideerVerhoekColli` faalt op gewicht. Moet gevuld worden vóór de pilot (bestaande zendingen handmatig of via script; nieuwe zendingen via gewicht-resolver).

---

## 2026-06-11 — Universele bevestig-knop: kanaal-dispatch EDI vs e-mail

**Aanleiding:** EDI-orders kregen nul orderbevestigingen na de EDI-cutover van 3 juni — de "Bevestig order"-knop stuurde altijd e-mail, ook bij EDI-orders. Bovendien werd de `orderbev_uit`-toggle in `edi_handelspartner_config` nergens gecheckt, waardoor partners die géén orderbev willen (SB Möbel BOSS 150761, Hammer 330955) er toch een kregen. Ontwerp-besluit: EDI-orders krijgen nooit e-mail; het kanaal hangt aan de order (`bron_systeem`), niet aan de klant.

- **`bepaalBevestigingKanaal` + `isOrderBevestigd`** ([`bevestiging-kanaal.ts`](../frontend/src/lib/orders/bevestiging-kanaal.ts)): pure dispatcher — `bron_systeem='edi'` + `transus_actief && orderbev_uit` → `'edi'`; `bron_systeem='edi'` anders → `'edi_stil'`; overige orders → `'email'`. Één bevestigd-predicaat: EDI-orders via gate `edi_bevestigd_op` (mig 158), gewone orders via `bevestigd_at` (mig 304).
- **`bevestigOrderZonderEdiBericht`** ([`bevestig-helper.ts`](../frontend/src/modules/edi/lib/bevestig-helper.ts)): kanaal `edi_stil` — zet uitsluitend de `edi_bevestigd_op`-gate via RPC `markeer_order_edi_bevestigd`, geen ORDRSP, geen e-mail.
- **Gedeelde hook `useBevestigEdiOrder`** ([`use-bevestig-edi-order.ts`](../frontend/src/modules/edi/lib/use-bevestig-edi-order.ts)): gedeeld door het amber leverweek-paneel (`edi-leverweek-bevestigen.tsx`) én de nieuwe `BevestigOrderEdiDialog`; laadt `edi_handelspartner_config` en bepaalt het kanaal.
- **`BevestigOrderEdiDialog`** ([`bevestig-order-edi-dialog.tsx`](../frontend/src/components/orders/bevestig-order-edi-dialog.tsx)): EDI-variant — leverweek kiezen, geen e-mailveld; bij `edi` → ORDRSP op `edi_berichten`-wachtrij → `transus-send`; bij `edi_stil` → alleen administratief.
- **Kanaal-dispatch in `order-header.tsx`**: groene knop opent bij `bron_systeem='edi'` de EDI-dialog, anders de e-maildialog; badge via `isOrderBevestigd`; "Opnieuw versturen" alleen voor niet-EDI.

## 2026-06-11 — Klant-niveau verzend-e-mailadres `debiteuren.email_verzend` (mig 369, branch `fix/dropship-afl-email`)

**Voorstel Piet-Hein (akkoord Marjon):** per klant een apart e-mailadres voor
het verzendadres, los van het algemene adres — in Basta stond dit noodgedwongen
bij de "openingstijden" omdat het echte e-mailveld anders ook de factuur kreeg.
Het grootste deel van zijn voorstel bestond al (mig 364: `afleveradressen.email`,
automatische overname bij orderaanmaak, per order aanpasbaar, "opslaan als vast
e-mail voor dit afleveradres"); dit voegt de ontbrekende klant-niveau-laag toe.

- **Mig 369:** `debiteuren.email_verzend TEXT`. Bewust géén backfill uit
  `email_overig` — de fallback zit runtime in de ladder.
- **Default-ladder `orders.afl_email`** bij orderaanmaak/adreskeuze
  ([`order-form.tsx`](../frontend/src/components/orders/order-form.tsx)):
  `afleveradressen.email` → `email_verzend` → `email_overig`. Dropshipment
  blijft uitgezonderd (geen enkele debiteur-default, mig 370); `email_verzend`
  telt daar mee in de verboden-set.
- **Checkbox in [`delivery-address-editor.tsx`](../frontend/src/components/orders/delivery-address-editor.tsx)**
  heet nu "Opslaan als vast verzend-e-mailadres voor deze klant" en schrijft
  naar `email_verzend` (was: `email_overig` — dat algemene veld voedt ook
  andere flows). Zo wordt het bestand organisch correct ("dan staat dit
  naarmate van tijd goed").
- **Klantpagina:** veld zichtbaar op klant-detail + bewerkbaar in
  [`debiteur-edit-dialog.tsx`](../frontend/src/modules/debiteuren/components/debiteur-edit-dialog.tsx).
- Mee-gefetcht in `ClientSelector`, `fetchSelectedClientVoorPrefill`
  (gespiegelde kolomlijst) en `fetchClientCommercialData` (edit-mode).

Automatisch vullen vanuit Basta is geparkeerd: het adres staat daar niet op een
consequente plek (bevestigd door Piet-Hein/Marjon). Typecheck + suite groen
(op de bekende pre-existing pickbaarheid-contracttest na).

## 2026-06-11 — Dropshipment: track & trace-e-mail mag nooit het factuur-adres zijn (mig 370, branch `fix/dropship-afl-email`)

*(Mig in de repo hernummerd van 368 → 370 vóór merge — origin/main nam parallel
368 in beslag met `368_intake_email_snapshots.sql`. Live uitgevoerd als "368".)*

**Melding Marjon (sales support):** "Het mailadres van de dropshipment voor de
track and trace is NIET hetzelfde als de factuur. Dus dat moet anders zijn."

**Diagnose:** bij een dropshipment-order levert Karpi rechtstreeks aan de
consument namens de winkel. Het orderformulier defaultte `afl_email` (= T&T-
adres richting vervoerder, mig 364/365) echter uit `debiteuren.email_overig`,
en backfill mig 367 deed hetzelfde op bestaande orders → de winkel kreeg de
track & trace, de consument niets.

**Herkenning als data (mig 370):** nieuw `producten.is_dropship` (TRUE op
DROPSHIP-KLEIN/GROOT) + SQL-predicaat `is_dropship_order(order_id)` — spiegelt
TS `detecteerDropshipKeuze`. Nieuw dropship-artikel = `UPDATE producten`.

**Fix in vier lagen:**
1. **Orderformulier** ([`order-form.tsx`](../frontend/src/components/orders/order-form.tsx)):
   bij dropship-keuze wordt een gedefault afl_email (= debiteur-/factuur-adres)
   leeggemaakt; klant-selectie en afleveradres-keuze defaulten niet meer naar
   de debiteur-e-mail zolang dropship actief is; opslaan blokkeert als
   afl_email gelijk is aan het factuur-/debiteur-adres (leeg = toegestaan,
   alleen amber hint — geen T&T is beter dan T&T naar de winkel).
2. **UI-hints:** rose/amber meldingen in
   [`delivery-address-editor.tsx`](../frontend/src/components/orders/delivery-address-editor.tsx)
   en op order-detail ([`order-addresses.tsx`](../frontend/src/components/orders/order-addresses.tsx)).
3. **Trigger-guard (defense-in-depth):** `fn_zending_fill_email` (mig 365)
   kopieert bij dropship-orders het order-afl_email NIET naar de zending als
   het gelijk is aan het factuur-/debiteur-adres.
4. **Data-fix:** open dropship-orders + nog niet verstuurde zendingen waar
   afl_email het factuur-/debiteur-adres was → NULL (operator vult het
   consument-adres aan; rose hint wijst erop).

Pure helper: [`dropship-email.ts`](../frontend/src/lib/orders/dropship-email.ts)
(`dropshipAflEmailProbleem`, case-/whitespace-ongevoelig) + unit tests.
Typecheck groen; suite groen op de bekende pre-existing pickbaarheid-test na.

## 2026-06-11 — Orderbevestiging-PDF in de taal van de klant (branch `feat/orderbevestiging-pdf-taal`)

**Melding Marjon (via Miguel):** orderbevestiging ORD-2026-0348 (Knutzen Wohnen,
DE) — de begeleidende e-mail was correct Duits, maar de PDF-bijlage stond
volledig in het Nederlands.

**Oorzaak:** `stuur-orderbevestiging` bepaalde de taal (uit `orders.fact_land`
via `normaliseer_land` → `bepaalTaal`) pas ná de PDF-generatie en gebruikte die
alleen voor de mail-HTML; [`_shared/orderbevestiging-pdf.ts`](../supabase/functions/_shared/orderbevestiging-pdf.ts)
had alle labels hardcoded in het Nederlands.

**Fix:**
- Nieuwe gedeelde module [`_shared/orderbevestiging-taal.ts`](../supabase/functions/_shared/orderbevestiging-taal.ts):
  `Taal`-type, `bepaalTaal` (DE/AT→de, FR→fr, NL/BE→nl, rest→en) en
  `vertaalOmschrijving` (hele-woord-woordenboek + frase "Op maat" → "Nach Maß"/
  "Sur mesure"/"Custom size") verhuisd uit de edge function — één taalbron voor
  mail én PDF.
- `genereerOrderbevestigingPDF` accepteert `taal?: Taal` (default `'nl'`) en
  vertaalt álle vaste teksten: documenttitel, info-labels, adresblok-koppen,
  tabelkolommen, eenheid, totaalregels, betalingsconditie, maatafwijking-
  disclaimer, opmerkingen, groet en paginanummering. Label→waarde-offsets zijn
  dynamisch (minimaal de oude NL-breedte) zodat langere vertalingen (bv. FR
  "Date de livraison:") niet overlappen.
- `stuur-orderbevestiging` bepaalt de taal nu vóór de PDF-generatie, vertaalt
  regel-omschrijvingen één keer (`regelsVertaald`, zelfde tekst op PDF en in
  mail) en geeft `taal` door aan de PDF. Mail-restje "Afhalen:" was ook nog
  hardcoded NL en is meertalig gemaakt.

Smoke-test: PDF gegenereerd in alle 4 talen (diakrieten Ä/ß/é/· renderen
correct door WinAnsi); pre-existing 2 typefouten in `resolveKlantEigenNamen`
(esm.sh supabase-js type-drift) staan los van deze wijziging.

## 2026-06-11 — Feedback-knop verplaatst naar de TopBar

De zwevende feedback-knop rechtsonder overlapte pagina-knoppen, zoals de
"Volgende"-paginering op het orders-overzicht. De knop staat nu permanent in
de bovenbalk naast het meldingen-belletje, in dezelfde donkere pill-stijl
zodat hij opvallend blijft. [`FeedbackWidget`](../frontend/src/components/feedback/feedback-widget.tsx)
wordt voortaan gerenderd in [`top-bar.tsx`](../frontend/src/components/layout/top-bar.tsx)
i.p.v. los in `AppLayout`; dialog en gedrag (pagina-URL, urgentie, bijlage)
ongewijzigd.

## 2026-06-11 — EDI/webshop-intake vult e-mail-snapshots (mig 368, branch `fix/intake-email-snapshots`)

**Melding Miguel:** order ORD-2026-0332 (HEADLAM) toont "Geen factuur-e-mailadres
bekend" terwijl de Facturering-tab van de klant wél `inkoop@headlam.nl` heeft.

**Diagnose (twee oorzaken):**
1. **HEADLAM-orders 0332/0333:** `orders.fact_email` is een per-order snapshot
   bij aanmaak (mig 364). De orders zijn om 13:04/13:09 ingevoerd, precies in
   het venster waarin het factuur-e-mailadres op de klant werd gewijzigd van
   `invoices@` naar `inkoop@headlam.nl` en tijdelijk leeg stond (0331 om 13:00
   had nog `invoices@`, 0335 om 13:15 had `inkoop@`). Later invullen op de
   klant werkt niet terug op bestaande orders — by design.
2. **Structureel gat:** mig 364 paste alleen de orderformulier-RPC's aan;
   `create_edi_order` en `create_webshop_order` (Shopify/Lightspeed/e-mail)
   vullen `fact_email`/`afl_email` niet. De eenmalige backfill (mig 367) ving
   bestaande orders, maar elke intake daarná landde leeg — bewijs:
   Hornbach-EDI-order ORD-2026-0334 (13:15, ná backfill) leeg terwijl de
   debiteur beide adressen heeft. Zelfde incidentklasse als mig 343
   (JSONB-sleutel-drop: nieuw veld niet in álle intake-paden).

**Fix (mig 368):** beide intake-RPC's passen dezelfde ladder toe als het
orderformulier: `fact_email` = `debiteuren.email_factuur` → `email_overig`;
`afl_email` = afleveradres-e-mail (EDI: de GLN-gematchte vestiging) →
`email_overig`. In `create_webshop_order` winnen expliciete `p_header`-waarden
(consument-e-mail uit de payload) en slaat de ladder `env_fallback`-orders
over (verzameldebiteur ≠ klant, mirrort mig 367-guard). De migratie sluit af
met een idempotente her-run van de mig 367-backfill die o.a. ORD-2026-0332/0333
en de lege EDI/Shopify-orders van 11-06 alsnog vult. Zelf-test bewaakt ook de
regressie-guards van mig 357 (status-literal) en mig 343 (maatwerk_vorm).

## 2026-06-11 — Voorraad-0-artikel toevoegen aan order: keuze prominent + levertijd vooraf zichtbaar (branch `fix/voorraad-0-artikel-toevoegen-ux`)

**Melding Marjon (sales support):** "Als een artikel geen voorraad heeft kan ik
hem niet aanklikken… Daarnaast kan ik ook niet zien wanneer het artikel weer
binnenkomt met welke levertijd." (voorbeeld LAGO13 240x340, art. 553130045 —
vrije voorraad 0, wél 20× besteld op inkoop.)

**Diagnose:** het pad bestond al (klik op voorraad-0-maat → `SubstitutionPicker`
→ "Toch toevoegen zonder voorraad" → allocator claimt op IO, mig 144-152), maar
was in de praktijk onvindbaar:
1. Het paneel rendert **onder** de volledige maten-lijst (LAGO kleur 13 = 16+
   rijen) — buiten beeld, klik leek niets te doen.
2. Alle 4 equivalenten (ROVE/GLOR/KAES/LAVA 13 240x340) hadden óók voorraad 0
   → elke rij in het paneel disabled/grijs — "ik kan hem niet aanklikken".
3. De ontsnappingsroute was een klein onderstreept linkje; de IO-levertijd
   (`IoLevertijdHint`) verscheen pas ná het toevoegen van de regel.

**Fix** (frontend-only, geen DB-wijziging):
- [`substitution-picker.tsx`](../frontend/src/modules/reserveringen/components/substitution-picker.tsx):
  nieuwe `InkoopVerwachtHint` toont direct in het paneel hoeveel er besteld is
  en de eerstvolgende verwachte leverweek (zelfde bron + FIFO-volgorde als
  `IoLevertijdHint`: `useOpenstaandeInkoopregelsVoorArtikel`, `verwacht_datum
  ASC`); "Toch toevoegen" is nu een prominente amber knop i.p.v. een linkje;
  equivalenten tonen ook hun `besteld_inkoop`; optionele `onCancel`-sluitknop.
- [`kwaliteit-first-selector.tsx`](../frontend/src/modules/maatwerk/components/kwaliteit-first-selector.tsx):
  zodra een voorraad-0-maat is aangeklikt verbergen de kleurchips + maten-lijst
  zich en staat het keuzepaneel direct in beeld (annuleren = terug naar lijst).
- [`article-selector.tsx`](../frontend/src/components/orders/article-selector.tsx):
  zelfde `onCancel`-route.

De daadwerkelijke claim blijft server-side (`herallocateer_orderregel`); dit is
puur de zichtbaarheid van een bestaand pad. Typecheck groen.

## 2026-06-11 — Backfill fact_email + afl_email op bestaande open orders (mig 367)

Mig 364 vult de e-mail-snapshots alleen bij nieuwe orders; bestaande orders
stonden leeg (geen factuur-e-mail, geen T&T). Mig 367 (live uitgevoerd
11-06-2026; in de repo hernummerd van 366 wegens collisie met
`366_verstuurde_emails_log.sql`) backfillt open orders
met dezelfde ladder als het orderformulier: `fact_email` uit
`debiteuren.email_factuur` → `email_overig`; `afl_email` uit het op
adres-snapshot gematchte `afleveradressen.email` (`_normaliseer_afleveradres`,
mig 222; laagste `adres_nr` wint) → fallback `debiteuren.email_overig`.
Guards: alleen lege velden, eindstatussen overgeslagen, en
`env_fallback`-orders (verzameldebiteur/consumenten-webshop) uitgesloten —
daar zou de debiteur-e-mail een verkéérd T&T-adres zijn. Sluit af met een
herhaling van de mig 365-zending-backfill zodat nog-niet-verstuurde
zendingen het gevulde adres als snapshot meekrijgen.

## 2026-06-11 — T&T- en factuur-e-mail expliciet gelabeld op order-detail + in adres-editor

**Waarom:** vervolg op de T&T-e-mail-keten (mig 364/365 hieronder) — op de
orderpagina stond het aflever-e-mailadres als kale grijze regel; nergens was
zichtbaar dat de vervoerder dáár de track & trace naartoe stuurt en het
factuur-adres nooit gebruikt.

**Wat:**
- [`order-addresses.tsx`](../frontend/src/components/orders/order-addresses.tsx):
  Afleveradres-blok kreeg een gelabelde regel **"Track & trace naar"** (verborgen
  bij afhaal-orders); leeg veld toont een amber hint "Geen e-mailadres ingevuld —
  klant ontvangt geen track & trace van de vervoerder". Factuuradres-blok toont
  `fact_email` (mig 364) als **"Factuur per e-mail naar"**.
- [`delivery-address-editor.tsx`](../frontend/src/components/orders/delivery-address-editor.tsx)
  (orderformulier): e-mailregel gemarkeerd met "· track & trace", lege staat in
  amber, en uitleg onder het invoerveld dat de vervoerder de T&T naar dit adres
  stuurt — niet naar het factuur-adres.
- `OrderDetail`-interface uitgebreid met `fact_email` (fetch was al `select('*')`).

De gevraagde gedragingen bestonden al: factuur-e-mail default vanuit
`debiteuren.email_factuur` en wijzigbare aflever-e-mail per order (mig 364,
orderformulier) — deze wijziging maakt de bestemming ervan zichtbaar.

## 2026-06-11 — E-mailtijdlijn op order-detail (mig 366)

**Waarom:** facturen en orderbevestigingen worden sinds 8 juni daadwerkelijk
gemaild via Microsoft Graph, maar nergens in RugFlow was per order te zien
wélke mails verstuurd zijn. Operators moesten daarvoor het M365-postvak in.
Spec: [`2026-06-11-order-email-tijdlijn-design.md`](superpowers/specs/2026-06-11-order-email-tijdlijn-design.md).

**Wat (branch `feat/order-email-tijdlijn`):**
- **Mig 366** — nieuwe tabel `verstuurde_emails` (rij per verstuurde mail per
  order: soort, onderwerp, ontvangers, html-body, bijlage-verwijzingen JSONB),
  nieuwe private bucket `orderbevestigingen`, en backfill van eerder
  verstuurde facturen (uit `facturen.verstuurd_op/verstuurd_naar`, rij per
  order via `factuur_regels`, EDI-only overgeslagen) en orderbevestigingen
  (uit `orders.bevestigd_at/bevestiging_email`) — zonder body (`html` NULL =
  "inhoud niet bewaard").
- [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts):
  na elke geslaagde Graph-send een log-rij per betrokken order (bundel-aware;
  betaler-kopie = eigen rij). Best-effort — logging blokkeert het mailen nooit.
- [`stuur-orderbevestiging`](../supabase/functions/stuur-orderbevestiging/index.ts):
  de PDF wordt voortaan ook bewaard in bucket `orderbevestigingen`
  (`{order_id}/Orderbevestiging-{order_nr}.pdf`, upsert) + log-rij met het
  taalafhankelijke onderwerp en de HTML-body.
- Frontend: sectie **"E-mails"** op order-detail
  ([`order-emails.tsx`](../frontend/src/components/orders/order-emails.tsx),
  lege staat "Nog geen e-mails verstuurd" zolang er niets is) — tijdlijn met datum/tijd,
  soort-badge en klikbaar onderwerp. Klik opent
  [`order-email-dialog.tsx`](../frontend/src/components/orders/order-email-dialog.tsx):
  ontvangers, body in **sandboxed iframe** (`sandbox=""` — mail-HTML kan nooit
  scripts draaien in RugFlow) en bijlage-knoppen via signed URL (10 min).
  Query [`verstuurde-emails.ts`](../frontend/src/lib/supabase/queries/verstuurde-emails.ts)
  + hook `useEmailsVoorOrder`.

## 2026-06-11 — Aflever-e-mailadres mee naar vervoerder voor track & trace (mig 365)

**Waarom:** mail Piet-Hein/Marjon 11-06-2026 — het order-formulier vult sinds
mig 364 automatisch aparte e-mailadressen voor factuur en aflevering. Het
aflever-e-mailadres is bedoeld voor track & trace: de vervoerder mag dáár
naartoe mailen, het factuur-adres nooit (klant krijgt wél T&T, niet de factuur).
HST stuurde `ToAddress.Email` tot nu toe altijd leeg.

**Wat (branch `feat/zending-afl-email-tnt`):**
- Mig 365: `zendingen.afl_email` (snapshot) + BEFORE-INSERT-trigger
  `trg_zending_fill_email` uit `orders.afl_email` — zelfde patroon als
  `afl_telefoon` (mig 339), maar **bewust zonder fallback** naar
  factuur-e-mailadressen. Backfill voor nog-niet-verstuurde zendingen.
- [`hst-send`](../supabase/functions/hst-send/index.ts): select + `ZendingInput`
  uitgebreid met `afl_email`; [`payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts)
  vult `ToAddress.Email` ermee (leeg blijft leeg). Test toegevoegd in
  `payload-builder.test.ts` (6/6 groen).
- Toekomstige vervoerder-koppelingen lezen hetzelfde snapshot-veld; of T&T-mail
  "mag" is dan een keuze per adapter, niet per order.

## 2026-06-11 — Zendingen + track & trace zichtbaar op order-detail (branch `feat/zending-herprint-ingang`)

De track & trace-code van een zending was alleen op de Zendingen-pagina te
zien; op de order zelf stond wel het verzenddocument maar niet de T&T-code.
Nieuw blok **Zendingen** op order-detail
([`order-zendingen.tsx`](../frontend/src/components/orders/order-zendingen.tsx),
stijl gespiegeld aan het Facturatie-blok): per zending het zending-nr (link
naar zending-detail), status-badge, vervoerder-tag, verzenddatum en de
track & trace-code uit `zendingen.track_trace` met kopieerknop. Zolang de
vervoerder nog geen code teruggaf staat er "nog geen track & trace"; zonder
zendingen rendert het blok niets (gouden regel). Orders-per-zending lopen via
de M2M `zending_orders` (mig 222), dus bundel-zendingen tonen ook correct.

## 2026-06-11 — HST-adresparser robuust voor werkelijke webshop-adressen (branch `feat/zending-herprint-ingang`)

**Incident ZEND-2026-0002 (vervolg op de Shopify-plaats-fix verderop):** HST
weigerde de transportorder twee keer met HTTP 400. (1) `splitAdres` kon
"Saturnusstraat 60 (Unit 30)" niet splitsen — de oude regex eiste een
toevoeging die met een letter begint, dus haakjes/blokhaken/reeksen
("(Unit 30)", "[001]", "1-5", allemaal échte adressen in de orders-tabel)
lieten `StreetNumber` leeg → HST 400 "Afleveradres niet aanwezig/compleet".
(2) Na die fix bleek HST een **max van 5 tekens** op `StreetNumberAddition`
te hanteren → "Unit 30" opnieuw 400.

**Structurele fix** ([`payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts), hst-send opnieuw gedeployed):
- `splitAdres` haalt (…)- en […]-delen eruit als toevoeging, negeert komma's,
  en pakt het eerste losstaande cijfer-token als huisnummer — een adres mét
  nummer kan nooit meer een lege `StreetNumber` opleveren.
- Nieuw `verdeelToevoeging`: toevoeging ≤5 tekens → `StreetNumberAddition`
  ("G", "001", "-5"); langer → `NameAddition` (HST's extra adresregel,
  "Unit 30"). Limiet als constante `HST_STREET_NUMBER_ADDITION_MAX`.
- 4 nieuwe Deno-tests met de letterlijke incident-adressen (8 totaal groen).

**Resultaat:** ZEND-2026-0002 alsnog verstuurd — HTTP 201, transportorder
T75038267000183, tracking op de zending, status "Onderweg", vrachtbrief-PDF
in storage. ZEND-2026-0001 (T75038267000181) en -0003 waren al goed.

## 2026-06-11 — Pakbon-layout naar oud Lieferschein-ontwerp

**Waarom:** de pakbon uit Pick & Ship moet qua layout lijken op het oude
Karpi Lieferschein-document (foto-voorbeeld KIBEK, 5 juni) — de vertrouwde
vorm voor magazijn én ontvangers. Goedgekeurd via visual-companion-mockup;
spec: [`2026-06-11-pakbon-lieferschein-layout-design.md`](superpowers/specs/2026-06-11-pakbon-lieferschein-layout-design.md).

**Wat (branch `feat/pakbon-lieferschein-layout`):**
- [`pakbon-document.tsx`](../frontend/src/modules/logistiek/components/pakbon-document.tsx)
  volledig herschikt: gecentreerd KARPI GROUP-logo, grote titel "Pakbon" met
  pakbonnr/datum ernaast, **afleveradres als hoofd-adresblok** (+ telefoon
  uit `zendingen.afl_telefoon`, mig 339), factuuradres verhuisd naar de body
  ("Factuuradres:", zoals "Rechnungsadresse"), referentieblok met
  `Order/Debiteur` + `Routecode` (uit `debiteuren.route`, legacy-import;
  regel verdwijnt als leeg), tabelkolommen **Rgl./Artikel/Omschrijving/
  Besteld/Geleverd** (eenheid inline), hoofdregel = Karpi-omschrijving met
  sub-regel "Uw naam: …" bij afwijkende klantnaam, **Kolli + Gewicht**
  i.p.v. Totaal m², vaste NL-disclaimer (maat-/kleurafwijking) boven de footer.
- "Leveringscond." uit het oude document bewust weggelaten — geen betrouwbaar
  veld in het schema (eerdere beslissing rond "Franco").
- Bundel-gedrag (mig 222) ongewijzigd: sub-kop per bron-order, bundel-lijst
  in het referentieblok.
- [`zendingen.ts`](../frontend/src/modules/logistiek/queries/zendingen.ts):
  `fetchZendingPrintSet` selecteert nu ook `afl_telefoon` en `debiteuren.route`.

## 2026-06-11 — Fix: blanco pagina tussen tapijt-stickers in de printset

Bij het printen van tapijt-stickers via Pick & Ship (zowel
[`zending-printset.tsx`](../frontend/src/modules/logistiek/pages/zending-printset.tsx)
als [`bulk-printset.tsx`](../frontend/src/modules/logistiek/pages/bulk-printset.tsx))
kwam tussen elke sticker een witte pagina mee. Twee oorzaken, beide gefixt
in de print-CSS van beide pagina's:

1. **Page-naam-mismatch:** `page: tapijt-sticker` stond alleen op het
   geneste `.sticker-label`, terwijl de forced page-break op de buitenste
   `.sticker-wrapper` zit. De wrapper viel daardoor op de *default* page —
   Chromium wisselt dan bij elke stickergrens van page-naam en injecteert
   een blanco tussenpagina. `page:` staat nu óók op de wrapper. (De
   maatwerk-bulkpagina `stickers-bulk.tsx` heeft één naamloze `@page` en
   had dit probleem dus niet.)
2. **Exacte fit:** de sticker was precies 148×106mm op een 148×106mm-page;
   sub-pixel-afronding of een onbedrukbare printerrand laat zo'n sticker
   overflowen → blanco vervolgpagina. Sticker print nu op 146×104mm
   (onderkant is toch witruimte, visueel geen verschil).

## 2026-06-11 — Shopify-plaats-bug + verzendset-herprint + verzendfout-signalering (branch `feat/zending-herprint-ingang`)

**Aanleiding (incident 11-06):** twee pickrondes (ZEND-2026-0001/0002) werden
foutief voltooid. De HST-transportorders strandden allebei op de pre-flight
"Naam, adres, postcode of plaats is leeg" — en dat bleek géén invoerfout maar
een **structurele Shopify-intake-bug**: 20 van de 26 Shopify-orders sinds mei
misten `afl_plaats`. Daarnaast bleken de facturen al automatisch gemaild
(per_zending-keten deed exact wat hij moest doen) en was er geen weg terug
naar Pick & Ship zonder handwerk.

**Root cause Shopify-plaats:** `extractShopifyShippingAddress`
([`_shared/shopify-types.ts`](../supabase/functions/_shared/shopify-types.ts))
leverde sleutel `afl_stad` (en `afl_bedrijf`/`fact_stad`), maar
`create_webshop_order` (mig 343) leest `p_header->>'afl_plaats'` /
`afl_naam_2` / `fact_plaats` — de JSONB-RPC dropt onbekende sleutels
geruisloos (zelfde bugklasse als het maatwerk_vorm-incident, mig 343).
**Fix:** sleutels hernoemd naar wat de RPC kent; zelfde fix in
`scripts/import-shopify-orders.mjs`; nieuwe contract-test
[`shopify-types.test.ts`](../supabase/functions/_shared/shopify-types.test.ts)
pint de geproduceerde sleutels vast op de RPC-kolomlijst (4 tests groen).
⚠️ **`sync-shopify-order` moet opnieuw gedeployed worden** voordat de fix
live is (neemt meteen de mig 325-RPC-hernoeming mee).

**Data-repair (eenmalig, met akkoord):** 17 NL-orders kregen `afl_plaats`
terug via de PDOK Locatieserver (BAG, postcode+huisnummer), incl. de
zending-snapshots ZEND-2026-0001 (Lijnden), -0002 ('s-Gravenhage), -0003
(Bennebroek). Niet hersteld: ORD-2026-0097 (geen adres), 0108/0123 (BE,
Willebroek — handmatig).

**Nazorg (11-06 middag, met akkoord):** dezelfde sleutel-drop raakte ook
`fact_plaats` — gemeld doordat ORD-2026-0107 een factuuradres zonder stad
toonde. Alle 22 getroffen Shopify-orders zijn gevuld vanuit **interne**
bronnen (debiteur-factuuradres/-postcode of het identieke afleveradres —
géén externe lookup; script `scripts/_tmp_repair_fact_plaats.mjs`), incl.
de twee BE-orders 0108/0123 (Willebroek via debiteur-postcode). Daarnaast is
`sync-shopify-order` gedeployed (was nog v8 van 10-06, vóór de fix) — de
sleutel-fix is nu pas écht live; nieuwe Shopify-orders krijgen zowel
`afl_plaats` als `fact_plaats`.

**Poll-pad ook gedicht (11-06 middag):** Shopify-orders komen feitelijk
binnen via `sync-shopify-orders-poll` (branch `feat/shopify-polling-sync`,
mig 323 — vervangt de fragiele webhook; code stond alléén op die branch,
niet op main). Die bundelde een **oude** kopie van `shopify-types.ts` mét de
`afl_stad`/`fact_stad`-bug — de webhook-fix dekte dit pad dus niet. Fix
geport naar die branch (commit 292d488: types + contract-test van main,
`shopify-order-processor.ts` op `afl_naam_2`) en `sync-shopify-orders-poll`
v13 gedeployed. Beide Shopify-intake-paden zijn nu sleutel-correct.

**Incident-terugdraai:** beide orders terug naar 'Klaar voor picken'
(verzonden_at NULL), zendingen terug naar 'Picken', Fout-transportorders op
'Geannuleerd'. Omdat `voltooi_pickronde` de voorraad-claims op `released` had
gezet (en `orderregel_pickbaarheid.is_pickbaar` op actieve claims leunt),
zijn de regels opnieuw gealloceerd via `herallocateer_orderregel` — orders
weer zichtbaar in Pick & Ship. Facturen FACT-2026-0001/0002 waren al gemaild
en blijven bewust staan (besluit Miguel): bedragen kloppen, de
`gefactureerd`-guard (mig 227) voorkomt een dubbele factuur bij de echte
verzending.

**Frontend (3 wijzigingen):**
- **Verzendset-herprint:** de printset-pagina (`/logistiek/:zending_nr/printset`)
  was alleen bereikbaar via de Pick & Ship-flow — pakbon/sticker vergeten
  printen = geen weg terug. Nu: "Verzendset printen"-knop op zending-detail +
  printer-icoon per rij op het zendingen-overzicht.
- **[`VerzendFoutBanner`](../frontend/src/components/orders/verzend-fout-banner.tsx)**
  op order-detail: een order kan "Verzonden" tonen terwijl de transportorder
  naar de vervoerder daarna faalde (voltooi_pickronde flipt de status vóór de
  HST-call). Rose banner met zending-link + foutreden zodra een zending een
  open HST-fout heeft (Fout-rij zonder actieve/geslaagde opvolger). Helper
  `bepaalOpenVerzendFouten` is puur en testbaar.

## 2026-06-11 — HST-verzendlabel tóch liggend op de 3"×6"-rol (mig 362)

**Waarom:** mig 361 (hieronder) introduceerde een staand 3×6-ontwerp, maar
Miguel wil expliciet het vertrouwde **liggende** ontwerp (zoals de oude
3"×2"-labels uit Windows Connect kwamen: tekst dwars op de uitvoer-richting),
alleen dan het volledige etiket vullend.

**Wat (branch `fix/hst-label-liggend`):**
- **Mig 362**: `hst_api` van 76.2×152.4 naar **152.4×76.2** (breedte×hoogte
  van de print-página; de fysieke rol blijft 76,2 breed — de ZDesigner-driver
  op **liggend** roteert het beeld op het etiket, exact de oude WC-flow).
- **Compact label schaalt mee** ([shipping-label.tsx](../frontend/src/modules/logistiek/components/shipping-label.tsx)):
  schaalfactor `s = hoogte/50.8` (1.5 op de 3×6) op rij-hoogtes, kolommen,
  paddings, fonts en kaderdiktes; adresblok centreert verticaal. Het staande
  ontwerp (`shipping-label-tall`) blijft bestaan voor portrait-formaten.
- **Barcode `fitMm`-prop** ([code128-barcode.tsx](../frontend/src/modules/logistiek/components/code128-barcode.tsx)):
  kiest zelf de grootste dot-aligned module-breedte (veelvoud 0.125mm =
  1 dot op 203dpi) die in de beschikbare ruimte past — groot én scanbaar.
- Banner-instructie oriëntatie is nu dynamisch: Staand bij hoog formaat,
  **Liggend** bij breed formaat (HST).
- **Driver:** terug naar **liggend** (zoals Miguels oorspronkelijke instelling),
  7,62×15,24, marges/schaal-instructies ongewijzigd.

## 2026-06-11 — HST-verzendlabel op 3"×6"-rol + thermische scherpte-fixes (mig 361)

**Waarom:** het verzendlabel op de Pick & Ship-verzendset stond hard op
76,2×50,8 mm (3"×2", oude ZD420-aanname) terwijl de fysieke rol in de Zebra
ZT231 76,2×152,4 mm (3"×6") is — het label vulde maar een derde van het etiket
en stond 90° gedraaid. Daarnaast oogde de print wazig: grijstinten en een
gestretchte barcode worden op een 203dpi thermische printer geditherd.
Betreft alléén het verzendlabel — pakbon (A4) en tapijt-stickers (148×106,
eigen printers) hebben hun eigen `@page`-regels en zijn ongewijzigd.

**Wat (branch `fix/hst-verzendlabel-3x6`):**
- **Mig 361** (`361_vervoerder_label_formaat_hst_3x6.sql`):
  `vervoerders.label_breedte_mm/label_hoogte_mm` van INTEGER → **NUMERIC(5,1)**
  (inch-rollen zijn fractioneel in mm) + `hst_api` op **76.2×152.4**. De
  bestaande per-vervoerder-formaat-keten (`labelFormaatVoor`, mig 207) pakt
  dit automatisch op in `@page shipping-label` én de instructie-banner.
- **Nieuw staand labelontwerp** [`shipping-label-tall.tsx`](../frontend/src/modules/logistiek/components/shipping-label-tall.tsx):
  `ShippingLabel` dispatcht op vorm — hoogte > breedte → gestapeld 3×6-ontwerp
  (afzender+vervoerder / order+product / groot adresblok / colli+referentie /
  grote SSCC-barcode), anders het bestaande compacte 3-rijen-grid (fallback
  voor vervoerders zonder formaat). Gedeelde data-helpers geëxtraheerd naar
  [`shipping-label-data.ts`](../frontend/src/modules/logistiek/lib/shipping-label-data.ts).
- **Thermische scherpte:** alle grijstinten (#475569/#64748b/#111) → puur
  `#000` (grijs = dither = wazig op thermisch); `Code128Barcode` kreeg een
  `moduleMm`-prop — het 3×6-label rendert op 0.375mm/module = exact 3 dots
  per module op 203dpi, dus balken op hele printer-dots.
- **Bugfix vervoerder-form:** een save op een niet-print-vervoerder (HST is
  type `api`) wiste `label_*_mm` stilletjes naar NULL
  ([`use-vervoerder-form.ts`](../frontend/src/modules/logistiek/hooks/use-vervoerder-form.ts)).
  Label-formaat wordt nu voor álle typen bewaard, accepteert 1 decimaal
  (komma of punt) en de velden staan op de detailpagina buiten het
  print-only-blok.
- **Driver-instelling (handmatig, ZDesigner ZT231):** papierformaat 7,62×15,24
  cm **staand** (was liggend), snelheid omlaag (≤7,6 cm/s), densiteit ~20+,
  Rasteren/dithering uit.

## 2026-06-10 — Bug-meldingen: verwerkingsnotitie + "verwerkt"-belletje voor de melder (mig 360)

**Waarom:** bij het op 'Verwerkt' zetten van een gemelde bug (mig 342) kon de
beheerder geen toelichting meegeven — de melder (bv. phdobbe) zag alleen een
statuswissel, niet *wat* er gedaan is of *hoe* het te testen. En de melder
kreeg nergens een signaal dat zijn melding behandeld was. Beide gevraagd door
Miguel n.a.v. het verwerken van een echte melding.

**Wat (branch `feat/bug-melding-verwerkt-notitie`):**
- **Mig 360** (`360_bug_melding_verwerkt_notitie.sql`):
  - Nieuwe kolommen op `bug_meldingen`: `verwerkt_opgelost` + `verwerkt_testen`
    (toelichting bij verwerken) en `verwerkt_gezien_op` (gezien-stempel melder).
  - `set_bug_status` herzien naar `(p_id, p_status, p_opgelost, p_testen)`
    (DROP + CREATE — extra params met default). Bij `Verwerkt`: schrijft de
    notitie (leeg→NULL via `NULLIF(btrim())`) en **reset `verwerkt_gezien_op`**
    (her-verwerking attendeert de melder opnieuw). `Open` wist notitie +
    stempel; `Geaccepteerd` impliceert gezien (`verwerkt_gezien_op = now()`),
    notitie blijft staan. Autorisatie ongewijzigd. Frontend roept de RPC met
    alleen `p_id`/`p_status` aan → defaults vangen dat op.
  - Nieuwe RPC `markeer_verwerkt_gezien()` (SECURITY DEFINER, scoped op
    `auth.uid()`): stempelt eigen `Verwerkt`-meldingen als gezien, retourneert
    het aantal. Dooft het belletje.
- **Frontend:** `BugMelding`-interface + `SELECT_COLS` uitgebreid;
  `setBugStatus(id, status, notitie?)` + `markeerVerwerktGezien()`
  ([`bug-meldingen.ts`](../frontend/src/lib/supabase/queries/bug-meldingen.ts));
  hooks `useSetBugStatus` (accepteert notitie), `useMarkeerVerwerktGezien` +
  helper `isVerwerktOngezien`
  ([`use-bug-meldingen.ts`](../frontend/src/hooks/use-bug-meldingen.ts)).
  - **Meldingen-pagina:** "Markeer verwerkt" opent een inline formulier met
    twee velden (*Wat is opgelost?* / *Hoe te testen?*); de toelichting verschijnt
    daarna als groen blok onder de melding (zichtbaar voor melder én beheerder).
    Bij openen van de pagina markeert de melder zijn ongeziene verwerkte
    meldingen als gezien.
  - **Topbar:** belletje (`Bell`) rechtsboven met rode teller = aantal eigen
    `Verwerkt`-maar-ongeziene meldingen; klik → `/meldingen`
    ([`top-bar.tsx`](../frontend/src/components/layout/top-bar.tsx)).
- **Nummering:** mig 358/359 waren al gereserveerd door de ongemergede branch
  `fix/maatwerk-form-artikel` (changelog-entry hieronder) → deze migratie kreeg
  **360**. Vóór merge opnieuw verifiëren (collisie-recept in geheugen).

**Toepassen:** mig 360 handmatig in Supabase draaien (MCP heeft geen toegang).

## 2026-06-10 — Maatwerk-form koppelt MAATWERK-artikel + karpi_code-borging (mig 358-359)

**Waarom:** sluitstuk van de "maatwerk zonder artikelnr"-saga (zie entry
hieronder, mig 356). Bug-melding phdobbe: ook **handmatige** op-maat-regels
uit het orderformulier landden zonder `artikelnr` (productie: ORD-2026-0166,
ORD-2026-0188). Root cause: `kwaliteit-first-selector` bouwde de regel met
`selectedKleur.artikelnr` — dat is het **ROL-product**-artikelnr uit RPC
`kleuren_voor_kwaliteit`, NULL als er geen rol-product bestaat — en een kale
`{KWAL}{KLEUR}`-concat als karpi_code-fallback (de "VERR14"-achtige
regel-codes). Eigenaar-besluit: een handmatige op-maat-regel koppelt het
**generieke MAATWERK-artikel** van (kwaliteit, kleur) — conventie
`{KWAL}{KLEUR}MAATWERK`, zelfde als het Shopify-intake-pad sinds mig 356.

**Wat (branch `fix/maatwerk-form-artikel`):**
- **Form-fix:** nieuwe smalle helper `fetchMaatwerkArtikelExact` in
  `maatwerk-runtime.ts` — alleen de exact-match-strategieën 1-3 van
  `fetchMaatwerkArtikelNr` (zelfde kwaliteit+kleur, `.0`-tolerant, actief),
  selecteert óók `karpi_code`. **Bewust géén strategie 4/5** (uitwisselbare
  kwaliteit / andere kleur): die leveren een artikel van een ANDERE
  kleur/kwaliteit — acceptabel voor `fysiek_artikelnr`/omsticker, niet voor
  de facturatie-`artikelnr`. `fetchMaatwerkArtikelNr` zelf ongewijzigd
  (bestaande callers intact). Beide op-maat-builders
  (`kwaliteit-first-selector.tsx` + `maatwerk-selector.tsx`) koppelen nu:
  artikelnr = exact MAATWERK-artikel, fallback rol-product (beter dan niets),
  anders undefined + `console.warn` (niet-blokkerend — orders-overzicht
  signaleert via `heeft_unmatched_regels`, mig 094); karpi_code = die van het
  gekoppelde product, fallback oud gedrag. Swap/omsticker-logica
  (`fysiek_artikelnr` via equiv) onaangeroerd.
- **Mig 358** (`358_herstel_maatwerk_regels_zonder_artikel.sql`): generiek
  herstel van bestaande artikel-loze maatwerk-regels in open orders (status
  niet Verzonden/Geannuleerd), **exclusief** `alleen_productie`-orders
  (ADR-0029: productie-only blijft bewust artikel-loos). Match op exact
  kwaliteit+kleur (`.0`-tolerant in beide richtingen) + omschrijving-patroon
  `^[A-Z]+[0-9]+MAATWERK$`; regel-karpi_code mee-gefixt als die NULL of de
  kale concat was. NOTICE-tellingen + informatieve zelf-test (restant-count,
  geen EXCEPTION — onbekende data).
- **Mig 359** (`359_producten_karpi_code_borging.sql`): trigger
  `trg_producten_karpi_code_guard` (BEFORE INSERT OR UPDATE OF karpi_code,
  product_type, omschrijving) borgt de invariant: rol/vast én
  MAATWERK-patroon-producten dragen een karpi_code. MAATWERK-patroon →
  auto-afleiden `{KWAL}{KLEUR}MAATWERK`; rol/vast → EXCEPTION (SQLSTATE
  `KA359`, geen stille afleiding — maat-info onbetrouwbaar). **Vrijgesteld:**
  `is_pseudo`, overig/staaltje buiten het MAATWERK-patroon (banden/calibra/
  staaltjes, eigenaar-besluit). **Legacy-veilig:** dubbele guard (UPDATE OF
  kolomlijst + IS DISTINCT FROM-check) zodat de dagelijkse voorraad-imports
  (`update_voorraad*.py`, UPDATEn alleen voorraad-kolommen) op legacy rijen
  met NULL karpi_code blijven werken. Zelf-test: trigger-existence +
  subtransactie-insert die op KA359 moet falen + informatieve legacy-count.
- **UI-borging:** Karpi-code-veld verplicht (HTML `required` + submit-guard
  met NL-melding) in `product-create.tsx` en `product-form.tsx` zodra
  product_type rol of vast is; auto-derive via `buildKarpiCode` blijft.
  Optioneel voor overig/staaltje.

## 2026-06-10 — Meerdere factuur-e-mailadressen per debiteur

Bugfix (branch `fix/meerdere-factuur-emails`): een operator kon op het
Facturering-tabblad geen tweede factuur-e-mailadres invullen — het veld was
`<input type="email">`, waarvan de browservalidatie meerdere adressen (spatie na
`@`) weigert. `debiteuren.email_factuur` is en blijft één TEXT-kolom; de adressen
worden nu komma-gescheiden opgeslagen (conventie `, `, zoals `verstuurd_naar`).

- **Frontend:** [`klant-facturering-tab.tsx`](frontend/src/modules/debiteuren/components/klant-facturering-tab.tsx)
  gebruikt nu `type="text"` + eigen validatie via nieuwe pure helper
  [`email-recipients.ts`](frontend/src/lib/email-recipients.ts)
  (`parseEmailRecipients` splitst op komma/puntkomma/whitespace, valideert elk
  adres, normaliseert naar `, `-gescheiden string; ongeldige adressen → inline
  foutmelding). Add-/edit-dialogs (`debiteur-add-dialog`, `debiteur-edit-dialog`)
  idem op `type="text"` gezet voor consistentie.
- **Edge function:** [`graph-mail-client.ts`](supabase/functions/_shared/graph-mail-client.ts)
  splitst `to` via gespiegelde helper [`_shared/email-list.ts`](supabase/functions/_shared/email-list.ts)
  (`splitEmailRecipients`) naar losse `toRecipients` — anders zou Microsoft Graph
  de komma-string als één ongeldig adres afkeuren. Seam-patroon zoals
  `_shared/debiteur-matcher.ts` ↔ frontend `product-matcher` (Deno-edge niet door
  Vite importeerbaar). Geldt automatisch ook voor de betaler-kopie en
  orderbevestiging.
- Tests: `email-recipients.test.ts` (vitest, 5×) + extra Deno-test in
  `graph-mail-client.test.ts` (multi-recipient split).

## 2026-06-10 — Order-status follow-ups: EDI-'Nieuw'-regressie hersteld (mig 357) + enum-TS-single-source

> **Nummering/dedup:** het plan claimde mig 353/354. Drie collisies met
> parallelle sessies: 353 = dropshipment, 354 = de B3-fix die op main al
> gedaan bleek, 355/356 = afleverdatum-sync + maatwerk-backfill. De EDI-mig
> van deze branch is hernummerd naar **357** (in de DB toegepast als "mig
> 355" — NOTICE-teksten dragen het oude nummer; inhoud identiek).

Restpunten uit de order-status-consolidatie (branch
`worktree-order-status-followups`):

- **B3 bleek parallel al gesloten** (mig 354 op main, zelfde
  `_apply_transitie`-aanpak — daar ook ontdekt dat de mig 308-INSERT crashte op
  de niet-bestaande kolom `actor`). Deze branch draagt alleen de
  lint-whitelist-notitie-update bij ("follow-up open" → "vervangen door mig
  354"). NB: de live functie draagt de variant van deze branch (extra
  `metadata.actor` + `search_path`-pin) — functioneel gelijk aan mig 354.
- **EDI-'Nieuw'-regressie hersteld (mig 357):** mig 309/312 hadden de mig
  275-patch ongedaan gemaakt waardoor EDI-orders sinds dien op de dode status
  `'Nieuw'` landden (zelf-helend zodra een orderregel-trigger
  `herbereken_wacht_status` aanroept, maar header-only/niet-getriggerde orders
  blijven hangen). Mig 357 herdefinieert schoon (volledige body = mig 312, één
  literal gewijzigd — geen `pg_get_functiondef`+`REPLACE`-truc meer) en
  backfillt hangende `'Nieuw'`-EDI-orders door de ladder (schade-query
  2026-06-10: **0** hangende orders — het zelf-helende orderregel-trigger-pad
  had alles al gecorrigeerd; de backfill is een no-op-vangnet).
- **`order_status` TS-single-source:**
  [`_shared/order-lifecycle/order-status.ts`](../supabase/functions/_shared/order-lifecycle/order-status.ts)
  (canoniek+legacy, set-semantiek) ⇄ golden-fixture ⇄ mig 350-assert, met een
  Vitest-contracttest die `ORDER_STATUS_COLORS` als eerste spiegel automatiseert
  (dekte al alle 17 waarden) en `satisfies`-typing op de
  `derive-status.ts`-lijsten (inhoud ongewijzigd).


## 2026-06-10 — Maatwerk altijd aan een productcode (matcher + mig 356)

**Waarom:** eigenaar-melding n.a.v. ORD-2026-0166 — maatwerk-orderregels uit
Shopify/Lightspeed landden soms zonder `artikelnr`, terwijl facturatie en EDI
het artikelnr lezen. Productie-bewijs: 3 regels (ORD-2026-0118 regel 1+2,
ORD-2026-0098 regel 1). Maatwerk moet altijd aan het generieke
`{KWAL}{KLEUR}MAATWERK`-artikel hangen (bv. LAGO13MAATWERK = 553139998).

**Wat (branch `fix/maatwerk-artikel-koppeling`):**
- **product-matcher vorm-pad:** niet-rechthoekig maatwerk (organisch/ovaal/
  rond) probeert nu óók `zoekMaatwerkProduct` en koppelt het generieke
  maatwerk-artikel; niet gevonden → `artikelnr: null`, exact het oude gedrag.
  Vorm + dims blijven in de `maatwerk_*`-velden. **Bewust géén auto-pricing
  voor vorm-regels:** de artikelnr-koppeling mag `haalKlantPrijs` niet
  activeren — het TS-prijspad kent de €75-vormtoeslag niet en kan een
  per-m²-verkoopprijs als regelprijs teruggeven. Vorm-maatwerk houdt dus
  `prijs NULL` zoals vóór de fix (operator prijst; zie €0,00-orders-
  werkitem), afgedwongen op beide call-sites (`sync-shopify-order` +
  `order-intake/lightspeed-regels.ts`). Rechthoek-maatwerk dat al vóór deze
  branch een artikelnr kreeg prijst exact als op main. **Redeploy nodig**
  voor `sync-shopify-order` / `import-lightspeed-orders` (gebeurt bij merge).
- **LUXR17-parse-fix:** ORD-2026-0098 regel 1 kreeg `maatwerk_kwaliteit_code
  = 'LUXR17'` (kwaliteit+kleur aaneengeplakt) met kleur NULL. Root cause:
  `import/import_shopify_csv.py` `match_product` — regex `^([A-Z]+\d*)`
  splitste de kleur niet af én zocht het MAATWERK-artikel in kolom
  `artikelnr` i.p.v. `omschrijving` (vond dus nooit iets). Gefixt — met
  geaccepteerde regex-randgevallen (letters-only SKU levert geen kwaliteit
  meer op, >6-letter-prefixen matchen niet meer; backfill-tool). In
  `product-matcher.ts` lopen alle vier maatwerk-return-paden nu via
  `resolveMaatwerkArtikel` — **unsplit-first**: de ONgesplitste kwaliteit
  wordt altijd eerst geprobeerd zodat een legitieme cijfer-eindigende
  `kwaliteit_code` (mig 098 anticipeert WLP1/WLP4) nooit kapotgesplitst
  wordt; pas bij een miss splitst `splitsKwaliteitKleur` de samengeplakte
  vorm (`^[A-Z]{2,6}\d{1,3}$`, LUXR17 → LUXR + 17).
- **Mig 356** (`356_maatwerk_artikel_koppeling_backfill.sql` — initieel 353, tweemaal hernummerd wegens collisies met `353_dropshipment_producten` en `354/355` (lifecycle-follow-ups) op main): (a) backfill
  `producten.karpi_code = kwaliteit_code || kleur_code || 'MAATWERK'`
  (catalogus-conventie, consistent met bestaande rijen als ALDO17MAATWERK;
  doel: catalogus-consistentie + document-/EDI-weergave — factuur-verzenden
  leest karpi_code) op generieke MAATWERK-artikelen met strikt
  omschrijving-patroon `^[A-Z]+[0-9]+MAATWERK$` (spiegelt mig 106),
  duplicaat-guard + NOTICE-skips; (b) herstel ORD-2026-0118 regel 1+2 →
  LAGO13MAATWERK-artikelnr; (c) herstel ORD-2026-0098 regel 1 → kwaliteit
  `LUXR`/kleur `17` + LUXR17MAATWERK-artikelnr. In expliciete
  `BEGIN;`/`COMMIT;` (huisstijl herstel-migraties 096/098), lookups
  deterministisch (`ORDER BY artikelnr` bij `LIMIT 1`), idempotent,
  lookup-gedreven (geen hardcoded artikelnrs), ontbrekende orders/producten
  → NOTICE+skip. Consequentie in `import_shopify_csv.py`: SKU's eindigend
  op `MAATWERK` slaan de karpi_code-equality-stap over (die zou na de
  backfill `is_maatwerk=False` zonder dims teruggeven) en vallen door naar
  de maatwerk-tak.
- **Tests:** `product-matcher.test.ts` (9, mock-patroon van
  `debiteur-matcher.test.ts`; incl. unsplit-first-pinning: (a) unsplit-hit
  wint en kwaliteit blijft ongesplitst, (b) unsplit-miss → split-hit
  gebruikt gesplitste waarden); `_shared`-suite 231 groen, enige faler is
  de bekende pre-existing `guillotine-packing.test.ts` REGRESSIE K1756006D.

**Bewust buiten scope:** karpi_code-borging via trigger/constraint op
`producten` (wacht op besluit banden/calibra-uitzondering); dubbele
"Selections"-regels in `sync-shopify-order` `buildRegels` (apart werkitem
met payload-bewijs).

## 2026-06-10 — Lifecycle-follow-ups: kapotte Concept-bevestiging + guard-completering (mig 354-355)

Vervolg op de hardening-branch (zie entry hieronder); branch
`fix/order-lifecycle-followups`.

> **Hernummering (zelfde patroon als 347-352):** toegepast als 353/354,
> hernummerd naar 354/355 wegens collisie met `353_dropshipment_producten`
> op main. DB-NOTICEs dragen de oude nummers.

- **B3 (mig 354) — `bevestig_concept_order` was kapot sinds mig 308:** de
  events-INSERT gebruikte de niet-bestaande kolom `actor` (en miste het
  verplichte `status_na`) → de RPC crashte bij élke bevestiging van een
  Concept-order (e-mail-kanaal) en de status-flip rolde mee terug. In de UI
  bedraad maar kon nooit succesvol draaien. Nu via `_apply_transitie`
  (ADR-0006): correcte event-rij, zelfde guards, zelfde herbereken-keten.
- **B14 (mig 355):** `'Maatwerk afgerond'` toegevoegd aan de eindstatus-guard
  van `sync_order_afleverdatum_met_claims` (zelfde klasse als B13: status-
  lijsten ouder dan mig 327). Risico was laag (maatwerk reserveert niet op IO
  in V1), guard nu compleet.
- **B8 — onderzocht, geen acute bug:** `lever_type` heeft `NOT NULL DEFAULT
  'week'` (non-issue); `lever_modus=NULL` bij externe orders met tekort is
  veilig voor de afleverdatum-sync (NULL = `'in_een_keer'`), maar (a) de
  levertijd-views tonen dan de eerste i.p.v. laatste IO-week en (b)
  zending-splitsen weigert tot de operator via order-bewerken een modus kiest.
  Aanbeveling (geen losse fix): bij landing defaulten uit
  `debiteuren.deelleveringen_toegestaan` — input voor de Order-landing-kern
  (Fase 2). Details: `docs/order-lifecycle.md` §11C/B8.

Beide migraties zijn op 2026-06-10 toegepast (als 353/354) en de
Concept-bevestiging is end-to-end getest met testorder ORD-2026-0201:
status flipte naar Klaar voor picken mét correcte `aangemaakt`-rij in
order_events (eerste succesvolle run van deze flow ooit).

## 2026-06-10 — Order-commit-pipeline: create-flow als pure functie (Fase 1 order-intake-verdieping)

- **Wat:** de create-flow-orkestratie uit `saveMutation.mutationFn` (order-form.tsx) is geëxtraheerd naar pure functie `bouwOrderCommit(input) → OrderCommitPlan` in `frontend/src/lib/orders/order-commit.ts`. Golden fixtures (8 scenario's, `__tests__/order-commit.fixtures.ts`) pinnen het bestaande gedrag: gemengde standaard/maatwerk-split, IO-tekort-split (sub-orders 'in_een_keer'), in_een_keer-met-tekort (géén split), verzend-naar-duurste met tie→deel A, admin-pseudo-skip, en de spoed-regel-eigenaardigheid (telt als IO-tekort, verhuist naar IO-deel).
- **Waarom:** plan 2026-06-10 order-intake-verdieping — de Order-commit (CONTEXT.md) testbaar maken als gedrags-anker vóór de Fase 2 Order-landing-kern (SQL). Strikt gedragsbehoud; verbeteringen (form-idempotency, uniform 'aangemaakt'-event) zijn expliciete Fase 2-beslispunten.
- **Niet gewijzigd:** RPC-laag (`create_order_with_lines`), edit-flow, `split-order.ts`-helpers.

## 2026-06-10 — Order-lifecycle-hardening: doc + 6 fixes (mig 347-352)

> **Hernummering:** deze migraties zijn op 2026-06-10 initieel toegepast als
> 346-350 en daarna hernummerd naar 347-351 wegens collisie met
> `346_derive_wacht_status_single_source` (parallel gemerged). De
> NOTICE-teksten in de DB-historie dragen de oude nummers. Mig 352 verenigt
> daarnaast de twee sporen (zie onderaan).

**Waarom:** sparring-sessie over codestructuur en bug-archetypen vóór de go-lives
van volgende week (verzending standaardmaten + maatwerk-productie). Onderzoek
(4 Explore-agents + handverificatie) leverde `docs/order-lifecycle.md` op — het
levende statusmodel-document (statussen, transities, gates, intake-matrix,
productie-/magazijnpad, RPC→laatste-migratie-tabel) — plus 12 getriageerde
bevindingen (§11 aldaar).

**Wat (branch `fix/order-lifecycle-hardening`):**
- **Nieuw levend document** `docs/order-lifecycle.md` — toetssteen voor elke
  flow-wijziging.
- **B2 (mig 347+348):** `voltooi_confectie` schrijft de terminale
  'Maatwerk afgerond'-flip nu via `_apply_transitie` met nieuw event-type
  `maatwerk_afgerond` (was directe UPDATE zonder audit-event, mig 330).
- **B1-vangnet (mig 349):** `match_edi_artikel` stap 3 (eerste-token-match)
  weigert wanneer de artikelcode-suffix een maat-patroon (`155x230`) of
  vorm-woord (`rund`/`rond`/`ovaal`) bevat — maat-informatie kan niet meer
  stilzwijgend gedropt worden; regel landt als ongematcht ('Actie vereist').
  Echte EDI-maatwerk-parsing = V2, eerst corpus verzamelen.
- **B4:** `import-lightspeed-orders` (cron-pad) bepaalt nu de afleverdatum via
  dezelfde `bepaalAfleverdatumUitOrder`-helper als het webhook-pad (was hard
  `NULL` → orders zonder deadline). **Redeploy nodig.**
- **B5 (mig 350):** snapshot-assert op de `order_status`-enum (set-vergelijking,
  mirror van mig 344) — enum wijzigen zonder de spiegels bij te werken faalt
  voortaan hard.
- **B11:** lint `lint-no-direct-orders-status-update.sh` scant nu ook
  `migrations/3*.sql`+ (mig 308/330 glipten door de oude `2*.sql`-scope;
  als bevroren historie ge-allowlist).
- **B12:** `ORDER_STATUS_COLORS` kende `'Maatwerk afgerond'` niet (badge zonder
  kleur) — toegevoegd.
- **B13 (mig 351, uit de code-review van deze branch):** `'Maatwerk afgerond'`
  ontbrak in de no-touch-lijst van `herbereken_wacht_status` (mig 275 is ouder
  dan mig 327) → een afgeronde productie-only order viel bij elke
  orderregel-touch terug naar `'Wacht op maatwerk'`, definitief. Toegevoegd aan
  de eindstatus-guard; SECURITY DEFINER + search_path expliciet herzet
  (218_z-les).
- **Mig 352 — samenloop met "order-status single-source" (mig 346) verenigd:**
  mig 346 (parallel gemerged én mogelijk al toegepast) delegeert de ladder aan
  de pure `derive_wacht_status`, maar diens guard miste `'Maatwerk afgerond'`
  óók (de truthtable pinde alleen de all-false-combinatie — met `maatwerk=true`,
  per definitie waar voor afgeronde productie-only orders, vuurde tak 4 alsnog).
  Mijn mig 351 (toegepast ná hun 346) herstelde tijdelijk de inline vorm en
  maakte de delegatie in de DB ongedaan. Mig 352 verenigt: `derive_wacht_status`
  mét de status in de guard + uitgebreide truthtable (échte B13-case), her-
  delegerende `herbereken_wacht_status`, SECURITY DEFINER herzet, en de
  TS-spiegel `derive-status.ts` + `derive-status.golden.json` zijn mee
  bijgewerkt (Vitest-contracttest dekt de nieuwe case).

Mig 347-351 zijn al toegepast (als 346-350, zie hernummering-noot);
**alleen mig 352 moet nog in de SQL Editor gedraaid worden.** Open follow-ups:
B3/B7-B10/B14 in `docs/order-lifecycle.md` §11C.

## 2026-06-10 — Order-status-ladder als single-source (Fase 2, ADR-0006)

De beslissingsladder die `orders.status` kiest stond inline in de PL/pgSQL-runtime
`herbereken_wacht_status` en was sinds mig 218 vijfmaal herschreven; bij mig 269/273
vielen de ADR-0016-takken (`Wacht op maatwerk`/`Klaar voor picken`) geruisloos weg
(orders 2063-2067 bleven op dode status `Nieuw`, mig 275 herstelde met de hand, geen
test ving het). Geconsolideerd naar één pure functie `derive_wacht_status(huidig, io,
tekort, maatwerk)` (SQL, mig 346) + TS-spiegel `deriveWachtStatus`
([`_shared/order-lifecycle/derive-status.ts`](../supabase/functions/_shared/order-lifecycle/derive-status.ts),
ADR-0006-belofte ingelost). Twee ankers binden ze: een golden-fixture-truthtable van
21 cases (Vitest-contracttest, TS ≡ fixture; alle 9 guard-statussen gepind, incl.
`Concept`/`Maatwerk afgerond` als huidig gedrag) en een zelf-testende migratie
(SQL ≡ dezelfde combinaties, incl. de regressie-cases). `herbereken_wacht_status`
verzamelt nog steeds de claim-/snijplan-state en delegeert nu de beslissing — gedrag
identiek aan mig 275 (bewuste trade-off: de drie EXISTS-queries draaien nu ook voor
eindstatus-orders; mig 275 returnde eerder vroeg). De toegepaste backfills
(mig 258/275) zijn bevroren history en blijven ongemoeid. Migratie 346 nog handmatig
in de SQL Editor te draaien.

Genoteerde follow-ups (buiten scope): schone herdefinitie van `edi_create_order`
(de pg_get_functiondef+REPLACE-patch uit mig 275 r164-197); `order_status`-enum als
TS-single-source (Fase 1-stijl); `herbereken_wacht_status` verloor sinds mig 258
stilzwijgend het SECURITY DEFINER + search_path uit mig 218_z (CREATE OR REPLACE
reset die attributen) — bewust besluit nodig of her-pinnen gewenst is (aparte
migratie); lint-script `lint-no-direct-orders-status-update.sh` scant alleen
`2*.sql`-migraties, glob verbreden naar 3xx. *(Update later die dag: de
SECURITY-DEFINER-her-pin, de lint-glob-verbreding én de `Maatwerk afgerond`-gap
in de guard zijn opgepakt in de order-lifecycle-hardening-branch, mig 351/352 —
zie entry hierboven.)*

## 2026-06-10 — Productie-only orders uit "zonder vervoerder"-teller (mig 345)

De banner "1165 order(s) zonder vervoerder" op Pick & Ship bestond voor 1066 stuks
uit Basta productie-only orders (`alleen_productie=TRUE`, bron `oud_systeem`,
ADR-0029) — daar doet RugFlow alleen snijden + confectie en blijft verzending in
Basta, dus een vervoerder kiezen is niet aan de orde. De `alleen_productie`-guard
uit mig 327 ontbrak in de view `orders_zonder_vervoerder` (mig 338). Mig 345 voegt
`AND NOT o.alleen_productie` toe; de teller toont nu de 99 échte gevallen (vrijwel
allemaal Duitse EDI-orders buiten HST-bereik). Geen frontend-wijziging — banner en
teller lezen de view.

## 2026-06-10 — Snijplan-status enum-seam (Fase 1 TS↔SQL-consolidatie)

`SnijplanStatus` (TS) miste `'Wacht'`+`'In productie'` t.o.v. de DB-enum
`snijplan_status` en er bestonden twee divergerende `SNIJPLAN_STATUS_COLORS`-maps.
Geconsolideerd naar één single-source (`frontend/src/lib/utils/snijplan-status.ts`):
enum-arrays + afgeleide types + semantische groepen (`TE_SNIJDEN`, `ROL_FYSIEK_BEZET`,
`INPAK_KANDIDAAT`, `CONFECTIE_INSTROOM`), met Deno-spiegel `_shared/snijplan-status.ts`.
Drie ankers binden TS aan SQL: Vitest-contracttest (TS ≡ golden snapshot), zelf-testende
migratie 344 (snapshot ≡ DB-enum), en lint-script tegen losse status-strings. Kleurmaps zijn
nu `Record<SnijplanStatus,…>` (compiler dwingt volledigheid); de divergerende kopie in
`rollen-groep-row.tsx` is weg. ~13 bestanden omgezet van magic-string-arrays naar de
semantische groepen (incl. een gemiste edge-function `check-levertijd`, gevangen door de lint).
Geen gedragsverandering — `confectie_orders` is leeg en `snijplannen` staat volledig op
`Gepland`. Migratie 344 nog handmatig in de SQL Editor te draaien.

## 2026-06-10 — create_webshop_order persisteert maatwerk_vorm (mig 343)

**Waarom:** slice 4 van het order-intake-plan (2026-06-09) liet Shopify én beide
Lightspeed-paden `maatwerk_vorm` meesturen in de regel-JSON, maar de regel-INSERT
in `create_webshop_order` (mig 322) kende die sleutel niet. JSONB geeft geen fout
op onbekende sleutels → het veld stierf geruisloos in de RPC en webshop-maatwerk
landde met `maatwerk_vorm = NULL`, waardoor het auto-snijplan van een rechthoek
uitging. Gevonden tijdens het order-aanmaak-verdiepingsonderzoek (architectuur-
review 2026-06-10).

**Wat (branch `fix/webshop-maatwerk-vorm`, mig 343):**
- `create_webshop_order` insert nu `maatwerk_vorm`, **gevalideerd** tegen
  `maatwerk_vormen(code)`: onbekende/lege code → NULL (order blijft landen, zoals
  nu), bekende code → gepersisteerd. Body verder byte-voor-byte mig 322;
  signatuur ongewijzigd.
- Zelf-testende migratie: asserteert dat de live definitie de lookup bevat én dat
  de drie codes die de TS-kant emit (`rond`/`ovaal`/`organisch_a`,
  `product-matcher.ts detectVorm`) in `maatwerk_vormen` bestaan.

**Waarom:** de monitor is HST-specifieke informatie en hoort bij de vervoerder zelf,
niet als los menu-item in de sidebar.

**Wat (branch `refactor/hst-monitor-onder-vervoerder`, frontend-only):**
- Monitor-inhoud (KPI's, open-fouten-tabel + retry, cron-health-waarschuwing) verplaatst
  van `pages/hst-monitor.tsx` (verwijderd) naar
  [`components/hst-monitor-panel.tsx`](../frontend/src/modules/logistiek/components/hst-monitor-panel.tsx).
- [`vervoerder-detail.tsx`](../frontend/src/modules/logistiek/pages/vervoerder-detail.tsx) kreeg
  tabs **Gegevens / Verzendmonitor** — alleen zichtbaar voor `hst_api`; de monitor-tab toont
  een rode `telHstAandacht`-badge. Nieuwe route `logistiek/vervoerders/:code/monitor`
  (zelfde component, tab via `useLocation`).
- Menu-item "HST-monitor" verwijderd uit `constants.ts`; de rode aandacht-badge in de
  sidebar zit nu op het nav-item **Logistiek**.
- Oude route `/logistiek/hst-monitor` redirect naar `/logistiek/vervoerders/hst_api/monitor`
  (bookmarks/muscle memory); `HstAandachtBanner` op Pick & Ship linkt direct naar de tab.

## 2026-06-10 — In-app feedback/bug-meldtool (mig 342)

**Waarom:** RugFlow gaat live bij de gebruikers; zij gaan tegen bugs/onvolkomenheden
aanlopen en moeten die laagdrempelig kunnen melden zonder de context te verliezen —
net als de feedback-popup in de LocoBrands-omgeving.

**Wat — frontend (branch `feat/feedback-bug-tool`):**
- **Zwevende `FeedbackWidget`** ([`feedback-widget.tsx`](../frontend/src/components/feedback/feedback-widget.tsx))
  rechtsonder op elke pagina (gerenderd in [`app-layout.tsx`](../frontend/src/components/layout/app-layout.tsx)).
  Modal met titel, omschrijving, urgentie en optionele screenshot/bijlage; legt
  **automatisch de huidige pagina-URL** (`window.location.href`) en de **ingelogde melder**
  (auth.users id + e-mail-snapshot) vast.
- **Gebruikersmenu rechtsboven** ([`top-bar.tsx`](../frontend/src/components/layout/top-bar.tsx)):
  het kale logout-icoon is vervangen door een uitklapmenu (avatar + chevron) met
  "Mijn meldingen" / (beheerder) "Alle meldingen" en "Uitloggen".
- **Meldingen-pagina** `/meldingen` ([`bug-meldingen.tsx`](../frontend/src/pages/feedback/bug-meldingen.tsx)):
  gebruiker ziet eigen meldingen, **Miguel (beheerder) ziet alle**. Beheerder zet
  `Open` ↔ `Verwerkt` (verwerken + terugzetten); de **melder accepteert** een verwerkte
  melding (`Verwerkt` → `Geaccepteerd`). Bijlage opent via signed URL.

**Wat — database (mig 342, handmatig toepassen):**
- Tabel `bug_meldingen` + enums `bug_melding_status` (Open/Verwerkt/Geaccepteerd) en
  `bug_urgentie` (Laag/Middel/Hoog). RLS: melder ziet eigen rijen, beheerder ziet alles
  (`is_bug_beheerder()` = Miguels e-mail uit JWT, gespiegeld in
  [`frontend/src/lib/bug/beheerder.ts`](../frontend/src/lib/bug/beheerder.ts)).
- Storage-bucket `bug-bijlagen` (privé, 10 MB, afbeeldingen + PDF).
- SECURITY DEFINER-RPC `set_bug_status(p_id, p_status)` dwingt de transitie-rechten af
  en stempelt `verwerkt_op`/`geaccepteerd_op`.

## 2026-06-09 — Order-intake consolidatie (gefaseerd, slices 0-4)

Plan: [`docs/superpowers/plans/2026-06-09-order-intake-consolidatie-gefaseerd.md`](superpowers/plans/2026-06-09-order-intake-consolidatie-gefaseerd.md). Branch `refactor/order-intake-consolidatie`.

- **Slice 0 — fix:** Lightspeed gewicht-conversie geünificeerd op micro-kg in gedeelde helper [`_shared/order-intake/gewicht.ts`](../supabase/functions/_shared/order-intake/gewicht.ts); `import-lightspeed-orders` deelde foutief door 1.000 (grams-aanname) → factor-1000 te laag gewicht, terwijl `sync-webshop-order` al door 1.000.000 deelde. Eén bron van waarheid + Deno-test.
- **Slice 1 — docs:** `architectuur.md` + ADR-0001 in lijn gebracht met de realiteit (`modules/orders/` bestaat niet; order-code leeft bewust verspreid over `components/orders/`, `lib/orders/`, `lib/supabase/queries/orders.ts`, `modules/orders-lifecycle/`).
- **Slice 2 — refactor:** drie intake-predicaten (Te koppelen / Te bevestigen / Debiteur te bevestigen) gecentraliseerd in pure helpers + filterhelpers ([`intake-predicaten.ts`](../frontend/src/lib/orders/intake-predicaten.ts), [`edi-leverweek.ts`](../frontend/src/lib/orders/edi-leverweek.ts) `filterLeverweekTeBevestigen`, [`modules/edi/lib/te-koppelen.ts`](../frontend/src/modules/edi/lib/te-koppelen.ts)); inline-kopieën in `fetchOrders`/`fetchStatusCounts`/`countTeBevestigenDebiteurOrders`/order-detail/`berichten-overzicht`/`countTeKoppelenEdiOrders` verwijderd. Filterhelpers casten intern i.p.v. zelf-refererende generic (vermijdt TS2589 op de Supabase-builder).
- **Slice 3 — refactor:** split-/verzend-toewijzing-logica uit [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) `saveMutation.mutationFn` geëxtraheerd naar geteste pure helpers [`lib/orders/split-order.ts`](../frontend/src/lib/orders/split-order.ts) (`wijsVerzendNaarDuurste` + `splitRegelOpDekking`). Geld-rekenende logica (maatwerk-split + IO-split, eerder 2× gedupliceerd) nu los testbaar; gedrag ongewijzigd.
- **Slice 4 — refactor:** gedeeld `IntakeRegel`-type ([`_shared/order-intake/types.ts`](../supabase/functions/_shared/order-intake/types.ts)) + gededupliceerde Lightspeed-regelbouw ([`_shared/order-intake/lightspeed-regels.ts`](../supabase/functions/_shared/order-intake/lightspeed-regels.ts) `buildLightspeedRegels` + pure `toIntakeRegel`); de twee near-duplicate `buildRegels` in `sync-webshop-order` en `import-lightspeed-orders` zijn vervangen. `sync-shopify-order` kreeg het eerder ontbrekende `maatwerk_vorm`-veld en emit nu `IntakeRegel[]`. EDI (SQL-pad `create_edi_order`) valt bewust buiten dit type.
## 2026-06-09 — Betaaltermijn als bron-van-waarheid (ADR-0022, mig 340-341)

Foute `regexp_match(betaalconditie, '^(\d+)')` in `genereer_factuur_voor_bundel`
pakte de betaalconditie-**code** (bv. "02") i.p.v. het aantal **dagen** (30) →
vervaldatum +2 i.p.v. +30 (FACT-2026-0021-klasse). Opgelost met centrale SQL-
helper `betaaltermijn_dagen(TEXT)` (mig 340) die de code-prefix opzoekt in
`betaalcondities.dagen` (mig 202/203) met vangnet "<n> dagen" en default 30;
`genereer_factuur_voor_bundel` consumeert die nu (mig 341). De andere historische
kopieën (`genereer_factuur`, `genereer_factuur_voor_week`) waren al door mig 240
gedropt — dit was de laatste live drager. Self-testing migratie borgt de bug-case.
(Migratienr verschoven van plan-claim 333/334 → 340/341 wegens collisie met
origin/main, dat inmiddels tot 339 liep.)

## 2026-06-09 — HST-observability + altijd-een-vervoerder (productie-klaar maken HST-koppeling)

**Waarom:** de HST-verzendkoppeling gaat van acceptatie naar productie. Twee gaten
blokkeerden dat: (1) orders zonder matchende vervoerder-regel bleven stil liggen — HST is
de enige actieve koppeling maar lag niet als bodem onder NL-orders; (2) de `hst-send`-cron
kon stilvallen / een transportorder mid-claim op `'Bezig'` laten hangen zonder zichtbaar
signaal (zelfde klasse als de EDI poll silent failure). Aanleiding bovendien: ACCP-afkeuring
2026-06-09 "Bellen voor aflevering, geef telefoonnummer op" — HST gaf kaal `"HTTP 400"`
terug en het leveringstelefoonnummer werd niet meegestuurd. Zie
[ADR-0030](adr/0030-altijd-een-vervoerder-en-hst-default-carrier.md) (bouwt voort op
[ADR-0008](adr/0008-vervoerder-keuze-als-deep-module.md)).

**Wat — migraties 336-339 (handmatig toepassen):**
- **mig 336:** `vervoerders.is_default BOOLEAN DEFAULT FALSE` (partial unique index
  `uk_vervoerders_is_default` → hooguit één TRUE) + seed `hst_api` als default + een
  **catch-all** rij in `vervoerder_selectie_regels` (`vervoerder_code='hst_api'`, prio
  `99999` = laagste, conditie `{"land":["NL"]}`, notitie "Default-vervoerder binnen NL").
  Mechanisme: de bestaande ladder in `effectieve_vervoerder_per_orderregel`
  (`override → regel → geen`, ADR-0008/mig 219) levert nu HST binnen NL via de catch-all;
  specifieke regels (lagere prio) winnen nog steeds. **Gegate op `hst_api.actief=TRUE`** —
  staat bewust nog FALSE tot de cutover, dus de default wordt pas dan effectief. Buiten NL
  blijft `bron='geen'` → "handmatig vervoerder kiezen".
- **mig 337:** RPC `herstel_vastgelopen_hst(p_minuten INTEGER DEFAULT 10) RETURNS INTEGER`
  (SECURITY DEFINER, GRANT authenticated) — self-healing reaper: zet `hst_transportorders`-
  rijen die >`p_minuten` op `'Bezig'` hangen terug naar `'Wachtrij'`. Bovenin elke
  `hst-send`-run aangeroepen + handmatig.
- **mig 338:** twee observability-views. `hst_verzend_monitor` (aggregaat, één rij, geen
  state): `verstuurd_vandaag`, `fout_open`, `wachtrij`, `bezig`, `oudste_wachtrij_minuten`,
  `oudste_bezig_minuten` — de laatste twee zijn het cron-health-signaal (hoog = verzend-cron
  staat stil; UI-drempel 5 min). `orders_zonder_vervoerder`: niet-afhaal-orders
  (`afhalen=FALSE`), status NOT IN (`'Geannuleerd'`,`'Verzonden'`,`'Concept'`), met ≥1 regel
  waarvan `effectieve_vervoerder_per_orderregel(...).bron='geen'` — voedt de
  "handmatig vervoerder kiezen"-teller/banner.
- **mig 339:** `zendingen.afl_telefoon TEXT` — snapshot leveringstelefoonnummer voor HST
  (die "belt vóór aflevering"). Gevuld door BEFORE-INSERT-trigger `trg_zending_fill_telefoon`
  (functie `fn_zending_fill_telefoon`): ladder `orders.afl_telefoon` → fallback
  `debiteuren.telefoon`. Bewust via trigger zodat álle zending-aanmaakroutes het veld vullen.
  Inclusief backfill voor nog-niet-verstuurde zendingen. (Hernummerd van 335 → 339 bij merge
  naar main wegens collisie met `335_orders_list_bevestigd_at.sql`.)

**Wat — edge function `hst-send` + gedeelde validator:**
- Nieuwe pure pre-flight validator [`_shared/vervoerder-eisen.ts`](../supabase/functions/_shared/vervoerder-eisen.ts)
  (`valideerVoorVervoerder(ctx) → {ok, problemen[]}`, codes `TELEFOON_ONTBREEKT` /
  `ADRESVELD_LEEG` / `LAND_BUITEN_BEREIK`, const `HST_LANDEN_BEREIK=['NL']`). Aangeroepen als
  laatste poort in `hst-send` vóór de POST — faalt een eis → rij direct op `Fout` met heldere
  reden, geen kansloze HST-call. Gespiegeld als frontend-kopie
  [`frontend/src/lib/orders/vervoerder-eisen.ts`](../frontend/src/lib/orders/vervoerder-eisen.ts)
  (Deno-edge niet door Vite importeerbaar; seam-patroon zoals `_shared/debiteur-matcher.ts`
  ↔ frontend `product-matcher`).
- Bugfix `hst-client.ts` `extractErrorMsg`: leest nu ook HST's PascalCase-veld
  `ErrorMessage` (operator kreeg eerder kaal `"HTTP 400"`).
- `payload-builder.ts`: vult `ToAddress.PhoneNumber` uit `zendingen.afl_telefoon`
  (was hardcoded leeg).

**Wat — frontend (module logistiek):**
- [`queries/hst-monitor.ts`](../frontend/src/modules/logistiek/queries/hst-monitor.ts)
  (query's + helpers `cronVermoedelijkStil`, `telHstAandacht`, `countOrdersZonderVervoerder`)
  en [`hooks/use-hst-monitor.ts`](../frontend/src/modules/logistiek/hooks/use-hst-monitor.ts)
  (TanStack-hooks, refetchInterval 30s/60s).
- Nieuwe route `/logistiek/hst-monitor`
  ([`pages/hst-monitor.tsx`](../frontend/src/modules/logistiek/pages/hst-monitor.tsx)):
  KPI's, open-fouten-tabel met echte `error_msg` + opnieuw-versturen-knop, cron-health-
  waarschuwing.
- [`components/hst-aandacht-banner.tsx`](../frontend/src/modules/logistiek/components/hst-aandacht-banner.tsx):
  rode/amber banner op Pick & Ship (MagazijnOverviewPage) bij open fouten / stilstaande cron
  / orders zonder vervoerder, plus nav-link naar de monitor. Spiegelt het
  `EdiTeKoppelenBanner`-patroon.

**Gevolg:** tweede vervoerder = eigen `vervoerder_selectie_regels` + `is_default`-vlag
omzetten — geen resolver-edit. Ladder en RPC uit ADR-0008 onaangeraakt; alle wijzigingen
strikt additief en geguard.

**Migraties:** 336-339 (handmatig). **ADR:** [0030](adr/0030-altijd-een-vervoerder-en-hst-default-carrier.md) (bouwt voort op [0008](adr/0008-vervoerder-keuze-als-deep-module.md)).

## 2026-06-09 — Orders-overzicht: kanaal-filter (EDI, Shopify, handmatig, oud systeem)

**Wat:** MultiSelectDropdown "Alle kanalen" op het orders-overzicht filtert op `bron_systeem`. Handmatig = `NULL` of `'handmatig'`; oud-systeem-orders afzonderlijk uit- of aan te zetten. `BronBadge` uitgebreid met expliciete labels voor `oud_systeem` ("Oud systeem") en `email` ("E-mail").

## 2026-06-08 — Productie-only orders uit Basta (Fase A): import + snijden/confectie, buiten facturatie

**Waarom:** Basta (het oude ERP) heeft een backlog nog-niet-gesneden maatwerk-orders.
Piet-hein wil die digitaal door RugFlow's snij- + confectie-planning laten lopen
(gestuurd door de packer/auto-planner, zichtbaar op de snijplanning, gereserveerd op de
rol) — terwijl factureren, verzenden en labels printen in Basta blijven. RugFlow dient
hier als snij-/confectie-tracker + opzoek-bord (op het Basta-ordernummer). Dit
**vervangt** [ADR-0028](adr/0028-maatwerk-voorraad-reservering-migratie.md)'s virtuele
`migratie_blokkering`: na import + planning worden de echte snijplannen de claim op de
rollengte (één bron van waarheid). Zie [ADR-0029](adr/0029-productie-only-orders-basta.md).

**Wat — migraties 327-331:**
- **mig 327** (schema): `orders.alleen_productie BOOLEAN NOT NULL DEFAULT false` (de
  schakelaar) + CHECK `chk_alleen_productie_bron` (`alleen_productie ⇒
  bron_systeem='oud_systeem'`); enum `order_status` krijgt terminale waarde
  **`'Maatwerk afgerond'`**; `order_regels.snijden_uit_standaardmaat` + idem op
  `snijplannen`; partiële indexen; verzameldebiteur **900000 'OUD SYSTEEM (PRODUCTIE)'**;
  partiële UNIQUE-index `orders_oud_order_nr_uniek` (idempotentie-sleutel).
- **mig 328**: `auto_maak_snijplan` + `auto_sync_snijplan_maten` kopiëren
  `snijden_uit_standaardmaat` naar het snijplan (additief — gewone regels → false).
- **mig 329**: RPC `import_productie_only_order(p_header JSONB, p_regels JSONB)
  RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)` — idempotent op `oud_order_nr`;
  maakt order (status `'In productie'`, `alleen_productie=true`,
  `bron_systeem='oud_systeem'`, `order_nr='OUD-<nr>'`) + maatwerk-regels (geen
  artikelnr/prijs). Geen allocator. Verzameldebiteur 900000 als fallback.
- **mig 330**: `voltooi_confectie` flipt een productie-only order naar
  `'Maatwerk afgerond'` zodra ALLE snijplannen confectie-afgerond zijn
  (`confectie_afgerond_op IS NOT NULL`). Strikt geguard op `alleen_productie=true`;
  gewone orders ongemoeid.
- **mig 331**: view `snijplanning_overzicht` + 3 kolommen (`alleen_productie`,
  `oud_order_nr`, `snijden_uit_standaardmaat`); geen filterwijziging.

**Wat — Python import:**
- `import/lib/afwerking_mapper.py`: mapt Basta's GROF+FIJN-afwerkingscodes naar
  FK-veilige `afwerking_types.code` (B/SB/FE/SF/LO/VO/ON/ZO). Niet-herkende codes →
  `B` (breedband) + gerapporteerd in de dry-run; biasband (DA) → `ON` (stickeren) in V1.
- `import/import_productie_only.py`: parset `totaalplanning_cleaned_v2.xlsx`, groepeert
  per Basta-ordernr, zet verzendweek (`WW-2026`) om naar de maandag-datum, roept de RPC
  aan. Dry-run default; `--commit` voert echt uit.

**Wat — frontend:**
- Pick & Ship-guard: `fetchOpenOrderHeaders` filtert `alleen_productie=false` → een
  productie-only order verschijnt nooit in Pick & Ship/facturatie/transport.
- Zoeken op Basta-nr (`oud_order_nr`) in `fetchOrders`.
- `BastaAfhandelingPaneel` op order-detail: amber signaal "afhandelen in Basta"
  (labels/verzenden/factureren), met "Maatwerk afgerond"-tekst zodra terminaal.
- `fetchStukken` (`_shared/db-helpers.ts`): sluit `snijden_uit_standaardmaat=true`-stukken
  uit van rol-packing (verbruiken geen rollengte, blijven zichtbaar in snijplanning +
  confectie).

**Gouden regel:** elke wijziging is geguard op `alleen_productie=true` (resp. de
standaardmaat-vlag); gewone orders blijven byte-voor-byte ongewijzigd.

**Migraties:** 327-331 (handmatig toepassen). **ADR:** [0029](adr/0029-productie-only-orders-basta.md) (vervangt 0028).

## 2026-06-08 — Orderbevestiging: ontbrekende velden uit oude PDF toegevoegd (e-mail + bijlage)

**Waarom:** vergelijking van de nieuwe Graph-mail-orderbevestiging met de
"HERBEVESTIGING"-PDF's van het oude systeem (`ob26485640.pdf`, `ob26499970.pdf`)
liet zien dat een aantal velden die klanten gewend zijn te zien, ontbraken —
zowel in de e-mailtekst als op de PDF-bijlage die de klant bewaart.

**Wat — beide in [`stuur-orderbevestiging`](../supabase/functions/stuur-orderbevestiging/index.ts)
en [`_shared/orderbevestiging-pdf.ts`](../supabase/functions/_shared/orderbevestiging-pdf.ts):**
- **Vertegenwoordiger** (`orders.vertegenw_code` → `medewerkers.naam`, zelfde
  resolutieketen als view `klant_omzet_ytd` — NIET de legacy `vertegenwoordigers`-tabel).
- **"Uw debiteurnr."** ook op de PDF (stond al in de e-mailtekst).
- Per regel: **eenheid** ("St", hardcoded voor echte productregels — er bestaat
  geen `eenheid`-kolom op `producten`/`order_regels`, mirrort de oude lay-out),
  **korting%** (`order_regels.korting_pct`) en een herhaalde **verzendweek**-subregel
  (bewuste keuze: het order-niveau-week herhalen i.p.v. een nieuwe per-regel
  IO-claim-berekening optuigen — de oude PDF toonde notabene ook bij de
  vrachtkosten-regel gewoon dezelfde week).
- **Orderreferentie** (`klant_referentie`) zichtbaar maken waar aanwezig
  (bevestigd door gebruiker als betekenis van de mysterieuze derde sub-regel
  "R26005850 T Groot Bleumink" op de oude PDF).
- **BTW-uitsplitsing** (`Totaalbedrag excl. btw` → `XX% btw over Y` →
  `Totaalbedrag incl. btw`) via de gedeelde `berekenFactuurTotalen`-helper, met
  `btw_percentage = COALESCE(debiteuren.btw_percentage, 21.00)` — **letterlijk
  dezelfde bron-van-waarheid en default als `genereer_factuur`**, zodat
  orderbevestiging en factuur niet uit elkaar lopen.
- **Maatafwijking-disclaimer** (vaste juridische tekst, letterlijk overgenomen:
  "Een geringe maatafwijking van +/- 3% alsmede een kleurafwijking kan optreden.").
- **Betalingsconditie** (`debiteuren.betaalconditie`, leidende numerieke code
  gestript: "31 - 30 dagen netto" → "30 dagen netto").
- **Afleveradresblok** ook in de e-mailtekst (stond al conditioneel op de PDF,
  ontbrak in de mailtekst zelf).
- Alle nieuwe labels vertaald in de bestaande 4-talen-`VERTALINGEN`-dictionary
  (nl/de/fr/en).

**Bewust niet gedaan (data-gaten, gerapporteerd aan gebruiker):**
- **Verzendmethode-code** (bv. "VRIJ2"/"HST10") — overbodig naast de al
  getoonde levertijd, op uitdrukkelijk verzoek weggelaten.
- **"Leveringsconditie"/"Franco"** — geen velden hiervoor in het schema
  (`debiteuren.gratis_verzending=false` voor beide referentie-debiteuren,
  ondanks "Franco" op één van de oude PDF's). Niet te betrouwbaar afleiden →
  bewust weggelaten i.p.v. gefabriceerd.
- **Fiscale bevinding (los van deze taak):** debiteuren met
  `btw_verlegd_intracom=true` (bv. #152004, #150762, #331114) hebben nog steeds
  `btw_percentage=21.00`, en de bestaande `genereer_factuur`-RPC negeert die
  vlag volledig — het intra-EU-verleggingsmechanisme lijkt dus nooit
  geïmplementeerd in de facturatie. Gebruiker koos bewust om de (mogelijk
  onvolledige) bestaande BTW-logica te spiegelen i.p.v. hier te diveren; dit is
  een apart fiscaal/compliance-aandachtspunt voor de boekhouding.

**Getest:** end-to-end testverzending op order ORD-2026-0001 (debiteur 150620,
NL, met vertegenwoordiger + regelkorting + betaalconditie) — `bevestigd_at`/
`bevestigd_door`/`bevestiging_email`-bijwerking nadien teruggedraaid.

### Vervolg dezelfde dag — correcties + PDF-redesign + logo-fix

Na gebruikersfeedback op de eerste versie:
- **Vertegenwoordiger** toont nu uitsluitend de naam (bv. "Astrid Roth"), niet
  langer "10 Astrid Roth" — de medewerkerscode wordt niet meer meegestuurd naar
  e-mail of PDF.
- **Betalingsconditie** is nu **uitsluitend op de PDF-bijlage** zichtbaar; is
  volledig verwijderd uit de e-mailtekst (incl. de bijbehorende `betalingsconditie`-
  sleutel uit de 4-talen-`VERTALINGEN`-dictionary en de orphaned helper in
  `index.ts` — de enige overgebleven `strippedBetaalconditie` leeft in
  `_shared/orderbevestiging-pdf.ts`, waar hij ook daadwerkelijk gebruikt wordt).
- **Logo verscheen nooit op de PDF — root cause gevonden en gefixt:** de oude
  default `KARPI_LOGO_PATH = 'logos/karpi-logo.jpg'` in combinatie met bucket
  `'documenten'` verwees naar een niet-bestaand storage-object (geverifieerd via
  `storage.objects`: het bestand staat op `public-assets/karpi-logo.jpg`, 25KB).
  De try/catch slikte de downloadfout stil in, dus niemand merkte het. **Fix:**
  `KARPI_LOGO_BUCKET = 'public-assets'` / `KARPI_LOGO_PATH = 'karpi-logo.jpg'`,
  zelfde conventie als het al-werkende `factuur-pdf/index.ts`.
- **PDF-redesign: het oude-systeem-template (`ob26499970.pdf`, "HERBEVESTIGING")
  nagebootst** in `_shared/orderbevestiging-pdf.ts`. De gekleurde/blokkerige
  stijl (terracotta titelbalk, slate tabel-headerbalk, zebra-gestreepte rijen)
  is vervangen door een rustigere, tekstgerichte lay-out die de merk-header van
  `_shared/factuur-pdf.ts` spiegelt: gecentreerd Karpi-logo bovenaan, "KARPI BV"
  + adresgegevens rechtsboven in `KARPI_ORANJE` (`rgb(0.76, 0.53, 0.22)` —
  afgeleid uit de gouden lijnkleur van het logo, dezelfde constante als in de
  factuur), een platte "ORDERBEVESTIGING"-labelregel (i.p.v. gekleurde balk,
  analoog aan "FACTUUR"/"HERBEVESTIGING" in het oude template), en een
  tabel-opmaak met dunne zwarte lijnen i.p.v. gekleurde balken/zebra-striping.
  Brengt orderbevestiging en factuur visueel in lijn — beide stammen uit
  dezelfde oude-systeem-"Custom ERP"-templatefamilie.

**Getest:** opnieuw end-to-end testverzending op ORD-2026-0001 naar
phdobbe@gmail.com (na deploy) — `bevestigd_at`/`bevestigd_door`/
`bevestiging_email` nadien weer teruggedraaid naar `NULL`.

## 2026-06-08 — Signalering levertijd-wijziging door leverancier-ETA-update (mig 326)

**Waarom:** sinds mig 318/319 kunnen leveranciers (supplier-portal) en Karpi
intern de ETA op een inkooporderregel aanpassen — `update_regel_eta`
propageert dat al **direct en stil** naar lopende klantorders:
`herallocateer_orderregel` herberekent de claims en de bidirectionele
`sync_order_afleverdatum_eta` (mig 319) verschuift `orders.afleverdatum` zowel
naar voren als naar achteren. Operationeel correct, maar onzichtbaar — een
order kon twee weken later gaan leveren zonder dat iemand het zag of de klant
daarover werd geïnformeerd. Gebruiker wilde dit zichtbaar: een overzicht +
per-order signalering, met een **handmatige** "herbevestigd aan klant"-afvinking
(geen automatische mail/EDI-bericht — dat regelt de operator zelf en legt het
hier vast als audit-trail).

**Wat:**
- `order_event_type` uitgebreid met `'levertijd_gewijzigd_door_eta'` (patroon
  mig 297: `ALTER TYPE ... ADD VALUE` vóór de functies die 'm gebruiken).
- Nieuwe nullable gate-kolom `orders.levertijd_wijziging_te_bevestigen_sinds`
  (TIMESTAMPTZ, NULL = niets open). Bewust **één** kolom i.p.v. een
  gemeld_op/bevestigd_op-paar (zoals `edi_gewenste_afleverdatum`/
  `edi_bevestigd_op`): die EDI-gate is eenmalig (vast bij order-aanmaak),
  terwijl deze gate herhaaldelijk open/dicht moet — en PostgREST kan niet
  filteren op kolom-vs-kolom-vergelijkingen (`bevestigd_op < gemeld_op`). Eén
  nulbare "open sinds"-timestamp is zowel het filterbare gate-predicaat
  (`IS NOT NULL`) als de weergavewaarde ineen.
- `sync_order_afleverdatum_eta` (mig 319) uitgebreid met detectie: vergelijkt
  de oude vs. nieuwe `afleverdatum` op **ISO-leverweek**
  (`verzendweek_voor_datum`, mig 228 — kleine dag-schuiven binnen dezelfde week
  triggeren bewust geen melding, mirrort EDI-leverweek/bundel-conventies). Bij
  een leverweek-verschuiving: logt een `levertijd_gewijzigd_door_eta`
  `order_events`-rij (met `afleverdatum_oud/nieuw`, `verzendweek_oud/nieuw`,
  `inkooporder_regel_id`, `eta_bijgewerkt_door`) en zet de gate op `now()`.
  Signaleert bij **elke** ETA-gedreven wijziging, ongeacht of de leverancier
  (portal) of Karpi intern de ETA aanpaste — de impact op de klant is gelijk.
  **Subtiele bug onderweg gefixt:** de "voor"-snapshot moet vóór
  `herallocateer_orderregel` worden gelezen — dat pad triggert zelf al
  `herwaardeer_order_status → sync_order_afleverdatum_met_claims`
  (forward-only), die de `afleverdatum` bij een latere ETA al naar de nieuwe
  waarde kan hebben geschoven vóórdat de detectie draait (oud == nieuw, geen
  melding; of bij een terugdraai: verkeerde "voor"-waarde). Opgelost met een
  expliciete `p_oude_afleverdatum`-parameter die `update_regel_eta` vult met
  de pré-allocatie-snapshot.
- Nieuwe RPC `markeer_levertijd_herbevestigd(order_id)` — idempotente
  gate-clearer (zet de kolom terug op NULL), mirrort `markeer_order_edi_bevestigd`
  (mig 158). Puur administratief, geen geautomatiseerde communicatie.
- `orders_list`-view: kolom toegevoegd zodat overzicht en detail erop kunnen
  filteren/conditioneren.
- Frontend: helper [`levertijd-wijziging.ts`](../frontend/src/lib/orders/levertijd-wijziging.ts)
  (`isLevertijdWijzigingTeBevestigen`, mirrort `edi-leverweek.ts`), nieuwe
  status-overstijgende tab **"Levertijd gewijzigd"** op het orders-overzicht
  (`levertijd_wijziging_te_bevestigen_sinds IS NOT NULL AND status NOT IN
  ('Verzonden','Geannuleerd')` — dit is het gevraagde *overzicht*), amber
  [`LevertijdWijzigingBanner`](../frontend/src/components/orders/levertijd-wijziging-banner.tsx)
  op order-detail (toont was-wk → wordt-wk + oorzaak, knop
  "Herbevestigd aan klant ✓"), en query
  `fetchLaatsteLevertijdWijziging` (mirrort `fetchInkomendBerichtVoorOrder`)
  voor de banner-detailweergave.
- Niet in scope (bewust, evt. latere iteratie): geen automatische
  klant-notificatie bij herbevestigen; geen inline oud→nieuw-badge in de
  orders-tabelrijen (de tab-filter zelf vormt het overzicht, volledige
  vergelijking staat op order-detail).
- Plan: `/Users/pd/.claude/plans/melodic-churning-haven.md` (lokaal, niet in git).

## 2026-06-08 — Factuur-/orderbevestigingsmail van Resend naar Microsoft Graph (M365)

**Waarom:** we gaan daadwerkelijk facturen en orderbevestigingen per mail versturen
vanuit RugFlow, en wilden eerst checken of de bestaande Resend-koppeling
betrouwbaar zou werken. Bleek niet: het Resend-verzenddomein `karpi.nl` stond op
**Failed** — ontbrekend MX-record + falende SPF op het `send`-subdomein, en de
DNS-provider (netzozeker.nl) liet via het zelfbedieningsformulier geen
aangepaste naam toe bij recordtype MX (alleen op de domein-apex). In plaats van
daar achteraan te blijven hobbelen: `karpi.nl` is namelijk **al correct
geconfigureerd voor Microsoft 365** (de bestaande MX wijst al naar
`protection.outlook.com`, de SPF bevat al `include:spf.protection.outlook.com`)
— dus is overstappen op verzenden via het bestaande M365-postvak zowel
eenvoudiger als betrouwbaarder, zonder enige nieuwe DNS-wijziging.

**Wat:**
- Nieuwe gedeelde module [`_shared/graph-mail-client.ts`](../supabase/functions/_shared/graph-mail-client.ts)
  (+ `graph-mail-client.test.ts`) — dunne wrapper rond de **Microsoft Graph
  `sendMail`-API**, met OAuth2 client-credentials-flow (Entra ID app-registratie,
  permissie `Mail.Send`, application-type met admin-consent). Spiegelt de oude
  `sendFactuurEmail(...)`-interface zodat de callers nauwelijks hoefden te wijzigen.
- [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts) en
  [`stuur-orderbevestiging`](../supabase/functions/stuur-orderbevestiging/index.ts)
  roepen nu `sendFactuurEmail` uit `graph-mail-client.ts` aan i.p.v.
  `resend-client.ts`. Nieuwe env-vars: `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`,
  `MS_GRAPH_CLIENT_SECRET` (vervangen `RESEND_API_KEY`); `FACTUUR_FROM_EMAIL` en
  `FACTUUR_REPLY_TO` blijven bestaan maar wijzen nu naar een echte M365-mailbox
  (bv. `facturen@karpi.nl`) — de app-registratie moet `Mail.Send` hebben voor die
  mailbox.
- `resend-client.ts` + `resend-client.test.ts` **verwijderd** (geen overige callers).

**Nog te doen (door gebruiker, buiten code-scope):** Entra ID app-registratie
aanmaken (Azure Portal → App registrations → New registration → API permissions
→ Microsoft Graph → Application permissions → `Mail.Send` → Grant admin consent
→ Certificates & secrets → nieuw client secret), en de vier secrets
(`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
`FACTUUR_FROM_EMAIL`) in Supabase edge-function-secrets zetten/bijwerken vóór
deploy. `RESEND_API_KEY`/`FACTUUR_REPLY_TO` (oud) kunnen daarna opgeruimd worden.

## 2026-06-07 — Carrier-payload-audit: rauwe HST request/response per poging bewaren

**Waarom:** de rauwe payloads van inkomende kanalen (Shopify, EDI) worden al
bewaard, maar uitgaand vervoerder-verkeer niet volledig. HST slaat z'n
request/response wél op `hst_transportorders` op, maar dat is **één rij die bij
elke retry overschreven wordt** (`markeer_hst_fout`, mig 171) — bij succes wordt
`error_msg` zelfs op NULL gezet. Daardoor verdwijnt de fout-historie van eerdere
pogingen, juist wat je bij diagnose nodig hebt. Doel: van élke carrier-poping de
ruwe payload herleidbaar houden, gekoppeld aan de order.

**Wat — mig 325:**
- Tabel `inkomende_payloads` (mig 324) **hernoemd naar `externe_payloads`** — de
  tabel had al een `richting`-kolom, de oude naam dekte de uitgaande lading niet.
  Eén centrale plek voor álle externe payloads (in + uit). Indexen mee hernoemd
  + nieuwe index `(richting, kanaal, ontvangen_op DESC)`.
- Neutrale RPC's `log_externe_payload(... p_richting, p_order_id, p_status, p_fout)`
  + `markeer_externe_payload_verwerkt`. Outbound carrier-calls leggen in één insert
  richting=`'out'`, `order_id` en de eindstatus vast.
- Oude namen `log_inkomende_payload` / `markeer_inkomende_payload_verwerkt` blijven
  als **deprecated wrappers** bestaan zodat de reeds-gedeployde `sync-shopify-order`
  niet breekt vóór de herdeploy.
- [`hst-send`](../supabase/functions/hst-send/index.ts): best-effort append-only
  logging na elke POST — `kanaal='hst'`, `richting='out'`, `order_id` gevuld,
  `payload_raw` = verstuurde request, `payload_json` = `{ request, response,
  http_code, ok, transport_order_id, tracking_number }`, status `verwerkt`/`fout`.
  Elke retry = nieuwe rij → volledige historie bewaard. PDF blijft uit de response
  gestript (staat in storage). Logging mag het versturen nooit blokkeren.
- [`sync-shopify-order`](../supabase/functions/sync-shopify-order/index.ts) overgezet
  naar de neutrale RPC-namen.

**Scope:** alleen HST (enige nu-actieve API-vervoerder). EDI-carriers
(Rhenus/Verhoek via `transus-send`) volgen zodra ze live gaan; backend-only, een
diagnose-UI is een aparte vervolgslice.

**Diagnose:** mislukte HST-verzendingen incl. retry-historie →
`SELECT externe_id, order_id, fout, ontvangen_op, payload_json FROM externe_payloads
WHERE kanaal='hst' AND richting='out' AND status='fout' ORDER BY ontvangen_op DESC;`

**Migratie:** 325 (handmatig toepassen). **Deploy:** `hst-send` + `sync-shopify-order`.

## 2026-06-07 — Debiteur-matcher-seam Slices 4–5: "debiteur te bevestigen" + env-ladder

**Waarom:** vervolg op de gedeelde debiteur-matcher-seam (Slices 0–3). Tot nu toe
werd de `zeker`-vlag van een match genegeerd: een onzekere fuzzy treffer
(bedrijfsnaam-deelmatch / e-mail) landde stil op de gegokte debiteur. Operator-keuze
(2026-06-07): zo'n order wél aanmaken maar markeren als "debiteur te bevestigen",
analoog aan de EDI "te koppelen"-flow, zodat geen order ongezien op de verkeerde
klant blijft staan.

**Wat — Slice 4 (mig 322):**
- Kolommen `orders.debiteur_zeker BOOLEAN DEFAULT true` + `orders.debiteur_match_bron TEXT`
  (audit: welke strategie won → locality op "waarom deze debiteur?").
- `create_webshop_order` (herdefinitie van mig 308) persisteert beide uit `p_header`
  (backward-compatibele `COALESCE`-default `zeker=TRUE`); `orders_list`-view (herdefinitie
  van mig 309) exposeert ze.
- [`sync-shopify-order`](../supabase/functions/sync-shopify-order/index.ts) stuurt
  `debiteur_zeker` + `debiteur_match_bron` mee i.p.v. `zeker` te negeren.
- **"Te bevestigen"-predicaat** = `debiteur_zeker=false AND (debiteur_match_bron IS NULL OR
  debiteur_match_bron <> 'env_fallback') AND status <> 'Geannuleerd'` — NULL-safe (een onzekere
  order zónder bron telt mee, valt niet stil uit beeld); één bron-van-waarheid:
  `countTeBevestigenDebiteurOrders` + de `'Debiteur te bevestigen'`-branch in `fetchOrders`
  + de JS-conditie op order-detail. **`env_fallback` valt bewust af:**
  de verzameldebiteur is voor consumenten-webshops (wisselend afleveradres) de verwachte
  eindbestemming, geen fout.
- UI: amber [`DebiteurTeBevestigenBanner`](../frontend/src/components/orders/debiteur-te-bevestigen-banner.tsx)
  + status-tab `'Debiteur te bevestigen'` op het orders-overzicht; bevestig-widget
  [`DebiteurBevestigenWidget`](../frontend/src/components/orders/debiteur-bevestigen-widget.tsx)
  op order-detail (`bevestigDebiteur` → `debiteur_zeker=true`, of corrigeren via order-bewerken).

**Wat — Slice 5:**
- `matchDebiteurViaEnv(envKey)` in [`_shared/debiteur-matcher.ts`](../supabase/functions/_shared/debiteur-matcher.ts):
  Lightspeed/webshop (`FLOORPASSION_DEBITEUR_NR`), Shopify-catch-all
  (`SHOPIFY_FALLBACK_DEBITEUR_NR`) lopen nu via één helper → `DebiteurMatch{bron:'env_fallback',
  zeker:false}`. Geen gedragswijziging; uniformeert het contract zodat échte Floorpassion-B2B-
  matching later achter dezelfde ladder kan.

**Tests:** +4 cases (`matchDebiteurViaEnv` + bestaande seam-suite groen, 18/18).
**Migratie:** 322 (handmatig toepassen). **Deploy:** `sync-shopify-order`, `sync-webshop-order`,
`import-lightspeed-orders` opnieuw deployen.
**Plan:** [`docs/superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md`](superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md).

## 2026-06-07 — Consolidatie ISO-week-kern (UTC) + `formatDateTime`

**Waarom:** een code-review markeerde twee duplicatie-clusters. (1) Het ISO-week­nummer
werd op ≥6 frontend- en 3 edge-plekken opnieuw uitgevonden, deels op **lokale tijd** —
een latente timezone-off-by-one rond middernacht/jaargrens op `orders.afleverdatum`
(een leverbelofte-veld dat de klant te zien krijgt, o.a. op de orderbevestiging).
(2) `formatDateTime` bestond als 5 component-lokale kopieën met onderling afwijkende
output, terwijl `formatters.ts` wél `formatDate`/`formatCurrency` had maar geen datum-tijd.

**Wat:**
- **Frontend week-kern** [`lib/utils/iso-week.ts`](../frontend/src/lib/utils/iso-week.ts)
  herschreven naar één **UTC-correcte, TZ-onafhankelijke** rekenkern (strippt de
  tijdcomponent). Nieuwe API: `isoWeekJaar`/`isoWeek`/`isoWeekString`/`isoWeekMaandag`/
  `maandagVanIsoWeek`/`isoWeekRange` + string-helpers `isoWeekJaarVanIso`/
  `isoWeekStringVanIso`/`isoWeekFromString` (backwards-compat). Test:
  [`__tests__/iso-week.test.ts`](../frontend/src/lib/utils/__tests__/iso-week.test.ts)
  (jaargrens, week 53, padding, TZ-robuustheid, SQL-pariteit — 28 cases, groen onder
  TZ Tokyo/UTC/LA).
- **Wall-clock-fix** (uit de code-review): de kern leest UTC-componenten, dus een rauwe
  `new Date()` zou in NL tussen lokaal 00:00–02:00 op de vóórgaande UTC-dag landen →
  verkeerde week. Helper `lokaleDatumAlsUtc(d)` verankert de lokale kalenderdatum op
  UTC-midnacht; `pickStatusVoor`/`bucketVoor`/`genereerWeekTabs`/`verzendWeekRelatief`
  draaien hun `vandaag` daardoorheen (de oude `verzendweek.isoWeek` deed dit impliciet
  via `Date.UTC(getFullYear…)`).
- [`lib/orders/verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts) **consumeert**
  de kern (eigen `isoWeek`/`isoMaandag` verwijderd, nu domein-alias); de 80+-case
  `verzendweek.test.ts` blijft ongewijzigd groen = bewijs dat de kern UTC-correct is.
- 4 frontend-duplicaten omgezet naar consumenten: `forward-planner.ts` (`isoWeekKey`),
  `supplier-portal.tsx`, `levertijd-suggestie.tsx` (`isoWeekUit`),
  `inkoop-regel-overzicht-tab.tsx` (`isoWeekLabel`). `buckets.ts` en `edi-leverweek.ts`
  meegetrokken naar UTC-consistente datum-constructie (`T00:00:00Z`).
- **Edge-kern** [`_shared/iso-week.ts`](../supabase/functions/_shared/iso-week.ts) +
  Deno-test toegevoegd (identieke set). `levertijd-capacity`, `spoed-check`,
  `levertijd-match` consumeren de kern; `stuur-orderbevestiging` z'n **buggy lokale-tijd**
  `verzendweekLabel` vervangen door de UTC-kern → week-label op de klant-orderbevestiging
  nu gelijk aan frontend + SQL. **Handmatig deployen**: `check-levertijd` +
  `stuur-orderbevestiging`.
- **`formatDateTime(iso, { seconds? })`** toegevoegd aan
  [`formatters.ts`](../frontend/src/lib/utils/formatters.ts); 5 kopieën vervangen
  (`confectie-tabel`, `berichten-overzicht`, `bericht-detail` met seconden,
  `hst-transportorder-card`, en `supplier-portal`'s lokale `formatDate` → centrale).
  *Zichtbare normalisatie:* `confectie-tabel` toont nu óók het jaar (DD-MM-YYYY HH:MM),
  conform de CLAUDE.md-datumconventie.
- Docs: `data-woordenboek.md` (Verzendweek), `architectuur.md` (ISO-week-kern +
  gedeelde formatters).

**Plan:** [`docs/superpowers/plans/2026-06-07-iso-week-formatdatetime-consolidatie.md`](superpowers/plans/2026-06-07-iso-week-formatdatetime-consolidatie.md).
SQL (`verzendweek_voor_datum` mig 228, `iso_week_plus` mig 145) blijft de overkoepelende
referentie en is **niet** gewijzigd.

## 2026-06-07 — Gedeelde `import/lib/`-helpers (dedup Python import-scripts)

**Waarom:** de batch-/normalisatie-helpers stonden massaal gekopieerd over de
import-scripts: `upsert_batch` **14×** (geen enkele uit een gedeelde module),
de numpy-`clean`/`_clean`-opschoning ~6×, en `norm`/`clean_gln` elk 3×. Naast de
onderhoudslast school er een **stille gedragsafwijking** in: `reimport_orders_2026.py`
definieerde een functie genaamd `upsert_batch` die in werkelijkheid `.insert()`
deed (geen `on_conflict`) — bij her-import van bestaande sleutels een
unique-conflict i.p.v. update, verstopt onder een naam die "upsert" belooft.

**Wat:**
- Nieuwe gedeelde modules onder [`import/lib/`](../import/lib/):
  - [`supabase_helpers.py`](../import/lib/supabase_helpers.py) — `create_supabase_client`,
    `upsert_batch(sb, …, *, mode="upsert"|"insert", on_conflict=…)`,
    `batch_delete`, `batch_select`. `sb` is expliciete eerste parameter (testbaar).
  - [`normalize.py`](../import/lib/normalize.py) — `norm`,
    `clean_value(*, date_fmt=…)`, `clean_gln(*, strict=…)`.
  - `lib/__init__.py` exporteert de publieke helpers.
- De `.insert`-afwijker (`reimport_orders_2026.py`) roept nu expliciet
  `upsert_batch(sb, …, mode="insert")` aan — afwijkend gedrag is **zichtbaar**.
- Alle 14 lokale `def upsert_batch` verwijderd; scripts importeren uit `lib`
  (Cluster A/B/C, incl. dode `BATCH`/`BATCH_SIZE`-constanten opgeruimd).
- Numpy-`clean`/`_clean` (6 scripts), `norm` (3 EDI-scripts) en de Transus-
  strict-`clean_gln` gemigreerd naar de gedeelde helpers (date-formaat per script
  via `date_fmt`, Transus via `strict=True`).
- Unit-tests toegevoegd in [`import/tests/`](../import/tests/): `test_supabase_helpers.py`
  + `test_normalize.py` (51 tests groen, incl. mock-`sb` upsert/insert-pad).
- Conventie vastgelegd in [`architectuur.md`](architectuur.md) (sectie "Import scripts").

**Plan:** [`docs/superpowers/plans/2026-06-07-import-lib-gedeelde-helpers.md`](superpowers/plans/2026-06-07-import-lib-gedeelde-helpers.md).

## 2026-06-04 — EDI-leverweek-bevestiging niet langer operationeel-blokkerend (mig 316)

**Waarom:** mig 309/310 maakte van de EDI-leverweek een voorstel en blokkeerde
onbevestigde EDI-orders (`bron_systeem='edi' AND edi_bevestigd_op IS NULL`) uit
zowel **Pick & Ship** als de **productie-intake** (snijplanning). De backfill van
mig 309 markeerde alleen orders in een late status of met bestaande orderbev als
bevestigd — alle ándere openstaande, al-pickbare EDI-orders werden in één klap
"te bevestigen" en verdwenen uit Pick & Ship. Operationeel gewenst gedrag is
echter dat zo'n order **hoe dan ook geleverd/geproduceerd** wordt; de
leverweek-bevestiging is een *administratieve* toezegging richting de klant
(orderbev draagt de bevestigde week), geen magazijn-/productie-poort.

**Wat:**
- Frontend ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)):
  de `isLeverweekTeBevestigen`-filter is uit `fetchPickShipOrders` verwijderd —
  onbevestigde EDI-orders zijn weer gewoon pickbaar.
- DB ([mig 316](../supabase/migrations/316_snijplanning_overzicht_edi_gate_weg.sql)):
  `snijplanning_overzicht` teruggedraaid naar de mig 290-vorm (alleen
  `WHERE o.status <> 'Geannuleerd'`) — onbevestigde EDI-maatwerk gaat weer de
  productie in.
- De **"Te bevestigen"-chip** (orders-overzicht) + de `EdiLeverweekBevestigen`-widget
  (order-detail) blijven bestaan als zichtbare reminder; `isLeverweekTeBevestigen`
  voedt nog de chip maar wordt niet meer als pickbaarheid-/productie-filter gebruikt.

## 2026-06-04 — EDI-leverweek als voorstel + bevestigingsstap (mig 309-310)

- **Probleem:** de door EDI-partners meegestuurde leverweek werd 1-op-1 in `orders.afleverdatum` gezet en de order stroomde direct door naar picken/productie — zonder toets op voorraad/inkoop.
- **Oplossing:** nieuwe kolom `orders.edi_gewenste_afleverdatum` (snapshot klantwens). EDI-orders zijn "te bevestigen" tot `edi_bevestigd_op` gezet is; zolang geblokkeerd uit Pick & Ship en `snijplanning_overzicht` (NULL-safe gate `(bron_systeem IS DISTINCT FROM 'edi' OR edi_bevestigd_op IS NOT NULL)`, raakt handmatige orders niet). Operator bevestigt de definitieve leverweek op order-detail (paneel `EdiLeverweekBevestigen`), wat `afleverdatum` vastzet en de orderbev (met bevestigde datum) verstuurt. Nieuw overzicht-filter "Te bevestigen" (excl. geannuleerd).
- **Raakvlak:** alleen EDI-orders; niet-EDI ongewijzigd. Gate hergebruikt mig 158 (`edi_bevestigd_op`), níet de mig 304 e-mail-bevestiging.

## 2026-06-04 — EDI-afleveradres matchte niet door ".0"-GLN-artefact — fix + backfill (mig 312)

**Waarom:** EDI-orders van centrale-facturatie-ketens kregen **allemaal hetzelfde afleveradres** — het debiteur-hoofdadres — terwijl de orders wel degelijk verschillende vestiging-GLN's meesturen. BDSK/XXXLutz (#600556): 39 orders, 37 unieke aflever-GLN's, tóch alle plaatsen = WUERZBURG. Oorzaak in drie lagen: (1) `afleveradressen.gln_afleveradres` is via de Excel-import als **float** ingelezen en mét `.0`-suffix opgeslagen (`9007019005225.0`) — 60 van de 64 GLN-afleveradressen; alleen de 4 handmatig via de koppel-widget ingevoerde Hornbach-adressen (#361208) stonden schoon, daarom werkte Hornbach wél. (2) `create_edi_order` matcht het afleveradres **exact** (`gln_afleveradres = v_gln_afl`), zonder de `.0`-tolerantie die `matchDebiteur` (transus-poll) wél heeft → schone binnenkomende GLN ≠ opgeslagen `.0`-GLN → terugval op hoofdadres. (3) `create_edi_order` is idempotent → bestaande orders werden nooit her-gesnapshot (zelfde mechaniek als de prijzen-backfill mig 308).

**Wat ([mig 312](../supabase/migrations/312_edi_afleveradres_gln_fix.sql)):**
- **`.0` opgeschoond** uit `afleveradressen.gln_afleveradres` (60 rijen).
- **`create_edi_order` `.0`-tolerant** gemaakt (`gln_afleveradres IN (v_gln_afl, v_gln_afl || '.0')`) — defense-in-depth tegen een toekomstige her-import.
- **Adres-backfill** op bestaande EDI-orders die nu matchen (analoog aan mig 308), met `IS DISTINCT FROM`-guard en uitsluiting van orders in een actieve/afgeronde bundel-zending (mig 230-lock). **24 orders** kregen hun juiste vestiging-adres (BDSK ging van 1 → 22 unieke plaatsen; o.a. FELLBACH/STUTTGART, DREIEICH, AUGSBURG, HEILBRONN, BRAUNSCHWEIG, NORDHORN).
- **Import gehardend** ([`import/supabase_import.py`](../import/supabase_import.py)): nieuwe helper `clean_gln` strip het float-`.0`-artefact bij import van `gln_afleveradres` én `gln_bedrijf`, zodat een her-import het niet opnieuw introduceert.

**Resterende gap (geen bug, data-volledigheid):** 57 EDI-orders staan nog op het hoofdadres omdat hun aflever-GLN **geen** afleveradres matcht — die vestigingen hebben geen GLN op het afleveradres (SB Möbel BOSS #150761: 1 afleveradres, 0 met GLN; FUG MITTE #630861: 24 afleveradressen, 0 met GLN; BDSK: 84 van 134 zonder GLN). Het EDI-bericht draagt enkel een GLN, geen adrestekst, dus het adres is niet uit de order af te leiden. Oplossing per vestiging: GLN koppelen via de koppel-widget (mig 306) of een GLN-aanvulling importeren. NB: voor klanten die feitelijk centraal leveren kán één adres correct zijn — per klant te verifiëren.

**Toepassen:** De data-fixes (opschonen + backfill) zijn **live uitgevoerd** via service-role REST. Mig 312 is het canonieke, idempotente record; de **functie-herdefinitie** (`create_edi_order` `.0`-tolerant) moet nog via `supabase db push` / de SQL-editor toegepast worden — daarna matchen nieuwe orders ook bij een eventueel teruggekeerd `.0`-artefact.

## 2026-06-04 — Hornbach-prijslijst (0251) geladen + koppeling + prijs-backfill (mig 311)

**Waarom:** De Hornbach-prijslijst is lokaal aangeleverd (`prijslijst0251_a hornbach.xlsx`, nieuw exportformaat mét EAN-kolom). Tot nu toe had Hornbach (debiteur **361208**, de enige ACTIEVE Hornbach — 361206/207/209/210/213/214 zijn Inactief) géén `prijslijst_nr` en hadden Hornbach-artikelen geen `producten.verkoopprijs`. Inkomende EDI-orders kregen daardoor orderregels zonder prijs (prijs NULL / bedrag 0). Zelfde situatie als de generieke mig 308-backfill, maar Hornbach kon toen niet mee omdat er nog geen prijslijst bestond.

**Wat:**
- **Import** ([`import/import_prijslijst_hornbach.py`](../import/import_prijslijst_hornbach.py), dry-run/`--apply`, gemodelleerd op `import_prijslijsten_nieuw.py`): `prijslijst_headers` nr=`0251` naam=`HORNBACH PER 1-4-2026` (geldig_vanaf 2026-04-01) + **1053** `prijslijst_regels` (artikelnr 9-cijferig + EAN + prijs + gewicht). 17 Excel-artikelnrs overgeslagen omdat ze niet in `producten` staan (ASLA99XX-assortie; staan op geen enkele order → geen impact, wel gerapporteerd zodat FK-fouten uitblijven).
- **Koppeling:** `debiteuren.prijslijst_nr='0251'` op 361208. Vanaf nu prijst `create_edi_order` (mig 159/166) nieuwe Hornbach-orders automatisch correct via de prijslijst.
- **Backfill** ([mig 311](../supabase/migrations/311_edi_prijzen_backfill_hornbach.sql)): dezelfde JOIN-logica als mig 308, gescoped op `prijslijst_nr='0251'`. De 4 bestaande EDI-orders (6 regels, allemaal prijs NULL) zijn gevuld met de prijslijstprijs (`prijs`/`korting_pct`/`bedrag`). De backfill is al via het import-script uitgevoerd; mig 311 is het canonieke, **idempotente** SQL-record (her-uitvoer = no-op).

**Toepassen:** Import + koppeling + backfill zijn live toegepast via het script (service-role REST). Mig 311 hoeft alleen nog in de Supabase SQL-editor gedraaid te worden als permanent migratie-record (verandert niets meer aan de data). Geen code- of functiewijziging.

## 2026-06-04 — Gebruikersbeheer: inlog-accounts uitnodigen & beheren

**Waarom:** Tot nu toe konden portaal-accounts (Supabase `auth.users`) alleen via het Supabase-dashboard worden aangemaakt. Karpi wil zelf vanuit het portaal collega's kunnen uitnodigen en beheren (o.a. thom, jeannet, anja, marjon, marjolein, regina @karpi.nl).

**Wat (geen DB-tabel — `auth.users` is de bron-van-waarheid via de admin-API):**
- **Edge function** [`gebruikers-beheer`](../supabase/functions/gebruikers-beheer/index.ts) (service-role) met acties `lijst` / `uitnodigen` / `wachtwoord-reset` / `blokkeren` / `deblokkeren` / `verwijderen`. `verify_jwt = false` op de gateway (publishable-key-vorm is geen JWT) — daarom verifieert de functie **zelf** het bearer-token van de aanroeper: alleen een ingelogde gebruiker mag deze admin-acties uitvoeren. Eigen account kan niet geblokkeerd/verwijderd worden.
- **Onboarding via uitnodigingsmail:** `inviteUserByEmail` (en `resetPasswordForEmail` voor reset) met `redirectTo` → nieuwe standalone-pagina [`/wachtwoord-instellen`](../frontend/src/pages/wachtwoord-instellen.tsx), waar de gebruiker zelf een wachtwoord kiest (`supabase.auth.updateUser`).
- **Frontend:** query-laag [`gebruikers.ts`](../frontend/src/lib/supabase/queries/gebruikers.ts) + hooks [`use-gebruikers.ts`](../frontend/src/hooks/use-gebruikers.ts) (TanStack Query), overzichtspagina [`/instellingen/gebruikers`](../frontend/src/pages/instellingen/gebruikers.tsx) met status-badges (Actief / Uitnodiging open / Geblokkeerd), laatste-login en rij-acties, en de [uitnodig-dialog](../frontend/src/components/instellingen/uitnodig-gebruiker-dialog.tsx). Nieuw nav-item "Gebruikers" onder *Systeem*.
- **Toepassen (handmatig):** `supabase functions deploy gebruikers-beheer`; in Supabase Auth de **SMTP** configureren (anders komen de invite-mails niet aan) en de redirect-URL `…/wachtwoord-instellen` + Site URL toevoegen aan de toegestane redirect-URLs. Daarna de 6 accounts uitnodigen via de pagina.

## 2026-06-04 — Backfill EDI-orderregelprijzen na klant(her)koppeling (mig 308)

**Waarom:** Een reeks inkomende EDI-orders is aangemaakt vóór de juiste debiteur gekoppeld was (de match faalde eerder op het factuur-GLN). `create_edi_order` (mig 166) prijst regels via `debiteuren.prijslijst_nr` → `prijslijst_regels`, maar omdat de debiteur — en dus de prijslijst — toen onbekend was, bleven de orderregels zonder (juiste) prijs. Ketens zonder product-verkoopprijs (bv. Hornbach-artikelen) → prijs leeg; ketens mét prijslijst (BDSK/XXXLutz, Möbel) → prijslijstprijs niet toegepast. De klantkoppeling staat inmiddels live (mig 306/307), dus `orders.debiteur_nr` wijst nu correct en de prijslijst kan met terugwerkende kracht worden toegepast.

**Wat ([mig 308](../supabase/migrations/308_edi_prijzen_backfill_na_klantkoppeling.sql)):** Eenmalige backfill — dezelfde JOIN als de backfill onderaan mig 166, nu herhaald zodat de net-gekoppelde orders worden meegenomen. Update EDI-orderregels (`bron_systeem='edi'`) waarvan de debiteur een `prijslijst_nr` heeft én er een `prijslijst_regels`-rij voor het artikel bestaat: `prijs` ← prijslijstprijs, `korting_pct` ← `debiteuren.korting_pct`, `bedrag` herberekend. De **prijslijstprijs is leidend**: lege regels worden gevuld én een afwijkende fallback-prijs (uit `producten.verkoopprijs`) wordt gecorrigeerd (`orr.prijs IS DISTINCT FROM pr.prijs`). Regels zonder prijslijstprijs (geen JOIN-match — o.a. Hornbach zonder prijslijst, maatwerk, ongematchte/pseudo-artikelen) blijven ongemoeid.

**Toepassen:** preview-query draaien (zie commit-bericht/PR), daarna mig 308 handmatig uitvoeren in de Supabase SQL-editor. Geen code- of functiewijziging — `create_edi_order` prijst nieuwe orders al correct sinds mig 166; dit is puur een data-backfill.

## 2026-06-04 — EDI debiteur-GLN-alias: meerdere factuur-GLN's per debiteur (mig 307)

**Waarom:** BDSK/XXXLutz (#600556) is de centrale debiteur voor de hele groep — orders matchen op de gefactureerd-GLN `9007019015989`, de besteller/aflever-GLN's zijn wisselende filiaalcodes. Eén order (klant-PO `8NLMC`, bericht 21) kwam binnen met een **afwijkende gefactureerd-GLN `9007019010007`** (een tweede factuur-entiteit) die nergens in de data stond → `matchDebiteur` faalde en de order bleef liggen. Aflever-GLN onthouden (mig 306) lost dit niet terugkerend op, want het afleveradres wisselt per order; de **factuur-GLN** moet als alias van de debiteur gelden.

**Wat (verticale slice DB → edge → frontend):**
- **Mig 307** — tabel `debiteur_gln_aliassen` (debiteur_nr, gln UNIQUE, rol `gefactureerd`/`besteller`, reden) + RPC `koppel_edi_debiteur_alias(p_bericht_id, p_debiteur_nr, p_gln, p_reden)`: legt de GLN als alias vast, zet `edi_berichten.debiteur_nr`, roept `create_edi_order` aan (die zonder afleveradres-match terugvalt op het debiteur-adres). Guard: GLN mag niet al aan een andere debiteur (alias of `gln_bedrijf`) hangen.
- **Edge function** [`transus-poll/matchDebiteur`](../supabase/functions/transus-poll/index.ts): nieuwe **stap 5** — besteller/gefactureerd-GLN → `debiteur_gln_aliassen.gln` (na `debiteuren.gln_bedrijf`, `.0`-tolerant).
- **Frontend** [`koppel-vestiging-widget.tsx`](../frontend/src/modules/edi/components/koppel-vestiging-widget.tsx): twee koppel-modi via segmented toggle — *"Op vestiging (aflever-GLN)"* (mig 306, ongewijzigd) en *"Op factuur-GLN (centraal)"* (mig 307, alias). Default = factuur-GLN-modus als de aflever-GLN ontbreekt maar er wél een factuur-GLN is. Query `koppelEdiDebiteurAlias` + hook `useKoppelEdiDebiteurAlias`.
- **Toepassen:** mig 307 draaien + `transus-poll` opnieuw deployen, daarna bericht 21 koppelen op factuur-GLN → BDSK #600556 (order wordt aangemaakt; toekomstige orders met `9007019010007` matchen automatisch).

## 2026-06-04 — Koppel-widget verrijkt met order-inhoud + prefill

**Waarom:** De bootstrap-koppel-widget toonde alleen de 3 GLN's — te weinig context voor de operator om te bepalen welke debiteur/vestiging erbij hoort. En bij een bericht zónder leesbare order (Transus-testbestand, #16) stond er een leeg koppel-formulier dat nergens toe leidt.

**Wat ([koppel-vestiging-widget.tsx](../frontend/src/modules/edi/components/koppel-vestiging-widget.tsx) + [bericht-detail.tsx](../frontend/src/modules/edi/pages/bericht-detail.tsx)):**
- **Order-inhoud-blok** uit de payload: afnemer-naam, klant-PO, gewenste leverdatum en de **orderregels** (aantal × artikelcode) — zodat de operator ziet om welke order het gaat.
- **Debiteur-zoek geprefild** met de afnemer-naam (`naam ilike %…%`), zodat de juiste klant meestal meteen in de lijst staat.
- **Guard:** koppel-widget alleen bij een echt geparseerde order (`payload_parsed` aanwezig). Berichten zonder order-inhoud krijgen een nette *"Niet koppelbaar — geen order-inhoud"*-melding i.p.v. een leeg formulier.

## 2026-06-04 — Safety-net: niet-gekoppelde EDI-orders zichtbaar op orders-overzicht

**Waarom:** Een inkomende EDI-order die niet automatisch aan een klant matcht (geen GLN-match → `order_id IS NULL`) was alleen zichtbaar in de EDI-module. De operator werkt in Orders, dus zo'n gemiste order kon tussen wal en schip vallen — en dat mag nooit (er kan een order verloren gaan).

**Wat:**
- **Count-query** `countTeKoppelenEdiOrders()` + hook `useTeKoppelenEdiCount()` ([edi.ts](../frontend/src/modules/edi/queries/edi.ts) / [use-edi.ts](../frontend/src/modules/edi/hooks/use-edi.ts)) — lichte `count`-query met dezelfde definitie als de EDI-badge: `richting='in' AND berichttype='order' AND order_id IS NULL` (filtert op `order_id`, niet op status). Pollt 30s mee.
- **Waarschuwingsbanner** [`EdiTeKoppelenBanner`](../frontend/src/modules/edi/components/te-koppelen-banner.tsx) bovenaan het orders-overzicht — rose alert, alleen zichtbaar bij ≥1 te koppelen order, met aantal + "Koppel nu" → `/edi/berichten?teKoppelen=1`.
- **Deep-link:** [berichten-overzicht](../frontend/src/modules/edi/pages/berichten-overzicht.tsx) leest `?teKoppelen=1` uit de URL en zet het te-koppelen-filter direct aan.
- Koppel-mutatie invalideert nu ook `['edi-te-koppelen-count']` zodat de banner meteen verdwijnt na koppelen.
- Geen migratie/data-wijziging; puur frontend safety-net op bestaande detectie.

## 2026-06-04 — Order-detail: omsticker-hint + "Toepassen"-knop bij uitwisselbare voorraad

**Waarom:** Een vaste-maat-orderregel zonder eigen voorraad maar mét beschikbare **uitwisselbare** voorraad (bv. SEVILLA 526690091 met 0 eigen voorraad, terwijl LAWRENCE 526690115 6 vrij heeft) toonde op het order-detail alleen de rode **"Wacht op nieuwe inkoop"**-sub-rij. Daardoor leek het alsof er geen voorraad was, terwijl de regel via omstickeren wél geleverd kan worden. Omstickeren is bewust een **handmatige keuze** (CLAUDE.md: "uitwisselbaar = handmatige claims"), dus de allocator vult het nooit automatisch — op een al opgeslagen order zonder die keuze ontbreekt elke hint.

**Wat:** Nieuwe component [`UitwisselbaarToepassenRij`](../frontend/src/modules/reserveringen/components/uitwisselbaar-toepassen-rij.tsx), gerenderd als extra sub-rij in [`order-regels-table.tsx`](../frontend/src/components/orders/order-regels-table.tsx) zodra een regel een ongedekt tekort (`te_leveren − Σ actieve claims > 0`) heeft.
- Haalt live de uitwisselbare voorraad op (`zoek_equivalente_producten`-RPC, gedeelde cache-key met de order-form-hint) en toont groen **"N× leverbaar via omstickeren uit …"**.
- Knop **"Omstickeren toepassen"** zet de handmatige claim direct via `set_uitwisselbaar_claims` — greedy-gevuld tot het tekort, bestaande handmatige claims behouden — zónder de hele order te hoeven bewerken. Daarna verversen de claims/levertijd en verschijnt de gewone omsticker-sub-rij; de hint verdwijnt.
- Werkt op **live voorraad**, dus ook voor reeds opgeslagen orders (bestaande + nieuwe).
- Cache-seam [`invalidateNaReserveringsmutatie`](../frontend/src/modules/reserveringen/cache.ts) invalideert nu ook `['equivalente-producten-summary']` zodat de vrije voorraad van het uitwisselbare bron-product na de claim klopt.

## 2026-06-04 — Fix: order-detail toonde "Klant —" (kapotte `debiteuren.email`-select)

**Waarom:** Na de EDI-instroom (BDSK, Hornbach e.a.) viel op dat order-detail bovenin **Klant —** toonde terwijl de orders-lijst de klant wél toonde en `orders.debiteur_nr` correct gevuld was. Geen koppel-probleem dus — de orders zijn correct aan hun debiteur gekoppeld. Bug trof **alle** order-details (niet EDI-specifiek), maar werd zichtbaar door de berg nieuwe EDI-orders.

**Oorzaak:** [`fetchOrderDetail`](../frontend/src/lib/supabase/queries/orders.ts) haalt de klantnaam via een aparte `debiteuren`-query die kolom **`email`** selecteerde — die kolom bestaat niet (`debiteuren` heeft `email_factuur`, `email_overig`, `email_2`). PostgREST gaf `42703 column debiteuren.email does not exist`; de error werd stil geslikt, `deb` werd `null`, dus `klant_naam` bleef `'—'`. De orders-lijst gebruikt de view `orders_list` (server-side join) en had er geen last van.

**Wat:** `email` → `email_overig` in de select én de `klant_email`-fallback (`email_factuur ?? email_overig ?? null`). Pure frontend-fix, geen migratie / data-reparatie nodig.

## 2026-06-03 — EDI bootstrap-koppeling vestiging (centrale facturatie + filiaal-levering)

**Waarom:** De eerste 4 echte Hornbach-orders na de EDI-cutover (id 17-20) werden geen order — `order_id IS NULL`, *"Geen debiteur gematcht op GLN"*. Oorzaak: centraal gefactureerd aan de **inactieve** hoofd-AG (361214) terwijl besteller/aflever-GLN per order een **NL-vestiging** is die nergens in de data stond. Correcte boeking = actieve NL-debiteur **361208** + de specifieke vestiging.

**Wat (Optie B — bootstrap, vestiging-GLN wordt onthouden → daarna automatisch):**
- **`matchDebiteur`** ([`transus-poll/index.ts`](../supabase/functions/transus-poll/index.ts)) herordend naar **meest-specifiek-eerst**: aflever-GLN → `afleveradressen`, besteller-GLN → `afleveradressen`, besteller/gefactureerd-GLN → `debiteuren.gln_bedrijf`. **Inactieve debiteuren overgeslagen** (geen Hornbach op 361214). Matching tolerant voor `.0`-import-artefact (`gln` én `gln.0`).
- **Mig 306** — RPC `koppel_edi_afleveradres(p_bericht_id, p_debiteur_nr, p_afleveradres_id)`: schrijft aflever-GLN naar het gekozen afleveradres (onthouden, guard tegen dubbel-koppelen), zet `edi_berichten.debiteur_nr`, roept `create_edi_order` aan. Idempotent.
- **Frontend:** gele koppel-widget op bericht-detail ([`koppel-vestiging-widget.tsx`](../frontend/src/modules/edi/components/koppel-vestiging-widget.tsx)) — onbekende GLN's + zoekbare debiteur-select + afleveradres-select → "Koppel vestiging + maak order". Overzicht-filter/-badge **"Te koppelen"** (`order_id IS NULL`, niet op status).
- **Docs:** bedrijfsregel in CLAUDE.md, §C-actie + dagboekregel in [`edi-logboek.md`](runbooks/edi-logboek.md).
- Vestiging-mapping (uit Transus-portaal): …208=Nieuwerkerk · …130=Wateringen · …109=Zaandam · …222=Best.

## 2026-06-03 — Voorraad-update vaste maten uit `Voorraadlijst 01-6-2026.xls` (2e ronde)

**Waarom:** Tweede periodieke vrije-voorraad-update van Karpi (na 29-5). Zelfde afspraken als de 1e ronde, maar met één noodzakelijke correctie op de uitsluitlijst.

**Wat:** Script [`import/update_voorraad_2026_06_01.py`](../import/update_voorraad_2026_06_01.py) (dry-run default, `--commit` schrijft). Gekopieerd van de 29-5-versie met één wijziging.
- **Uitsluitlijst groeit nu echt (union i.p.v. overschrijven):** de 29-5-versie overschreef [`import/voorraad_uitsluiten.csv`](../import/voorraad_uitsluiten.csv) met alleen de rode regels van die ene lijst. Dat bleek fout: Karpi markeert de "niet meer inladen"-artikelen **progressief, alfabetisch** — de 29-5-lijst had rood A (ABST)→F (FADE), de 1-6-lijst heeft rood E (ETII)→K (KAED). De A–D-regels zijn in het 1-6-bestand niet meer rood. Overschrijven zou 2.905 eerdere uitsluitingen verliezen. Nieuw gedrag: `exclude = bestaande csv ∪ nieuwe rode regels`. Uitsluitlijst gegroeid 2.917 → **5.404** (2.487 nieuw rood toegevoegd).
- **Resultaat (commit):** 16.107 vast geüpdatet uit lijst · 1.891 uitgesloten→0 · 30 niet-in-lijst→0 · **0 nieuw aangemaakt** (DB al gevuld in 1e ronde; 103 vaste maten met 0/neg en 1.056 broadloom overgeslagen). Totaal 18.028 `vast`-producten herschreven.
- **Scope ongewijzigd:** alleen `product_type='vast'`. Staaltje (3.691), rol (798), overig (1.807) bewust ongemoeid. Sleutel kol A `Artikelnr`, waarde kol H `Vrije voorraad`; `backorder`/`gereserveerd` op 0; negatieve voorraad geclampt naar 0.
- **Rapport:** [`import/rapporten/voorraad_update_2026_06_01.xlsx`](../import/rapporten/voorraad_update_2026_06_01.xlsx).

## 2026-06-03 — EDI factuur-uitgaand (INVOIC) + go-live monitoring-logboek

**Waarom:** Na de big-bang EDI-cutover (2026-06-03) restte één functionele gap:
facturen automatisch via Transus versturen aan de ~10 partners met `factuur_uit=true`.
De fixed-width INVOIC-builder bestond al; alleen het pad factuur → uitgaande wachtrij ontbrak.

**Wat:** Plan [`docs/superpowers/plans/2026-06-03-edi-factuur-uitgaand.md`](superpowers/plans/2026-06-03-edi-factuur-uitgaand.md).
- **Scope V1:** alleen per-order facturen (1 order per factuur). Multi-order/weekly volgt later.
- **Keuzes (met gebruiker):** handmatige knop (géén DB-trigger op `facturen.status` → bestaande facturatie ongemoeid); payload gebouwd in een **edge function** die de bestaande builder hergebruikt (geen frontend-mirror, DRY); `transus-send` blijft dom (stuurt alleen `payload_raw`).
- **Pure mapper** [`_shared/transus-formats/factuur-mapper.ts`](../supabase/functions/_shared/transus-formats/factuur-mapper.ts) (`FactuurEdiData → KarpiInvoiceInput`) + Deno-test (8 cases groen: BTW-verlegd 0%, `bes_*`-fallback naar invoicee, missing-GTIN-throw, land→ISO-normalisatie, builder-integratie).
- **Edge function** [`bouw-factuur-edi`](../supabase/functions/bouw-factuur-edi/index.ts): valideert single-order + `factuur_uit && transus_actief`, haalt factuur/order-partijen/GTIN's op, bouwt INVOIC, idempotente insert in `edi_berichten` (`richting='uit', berichttype='factuur'`, UK op `(berichttype, bron_tabel, bron_id)`).
- **Frontend:** knop "Verstuur via EDI" op factuur-detail — **alleen zichtbaar** voor debiteuren met `edi_handelspartner_config.factuur_uit && transus_actief` (dubbel afgedwongen: UI verbergt + edge function weigert met 422). Knop disabled bij multi-order factuur.
- **[Logboek](runbooks/edi-logboek.md):** dag-na-dag go-live monitoring met 5 copy-paste health-check-queries.
- **Centraal EDI-partners-overzicht** (`/edi/partners`, sidebar "EDI → Handelspartners"): read-only tabel met per partner welke berichten actief zijn (order-in / orderbev / factuur / verzending) + test-modus + actief-status. Aanvulling op de bestaande per-klant EDI-tab (Klant → tab "EDI"), die bewerkbaar blijft. Kolommen leiden labels af uit de berichttype-registry.
- **⚠️ Te deployen:** `bouw-factuur-edi` moet nog naar Supabase gedeployed worden (met JWT-verificatie aan — wordt door de ingelogde frontend aangeroepen, niet door cron).

## 2026-05-31 — Voorraad-update vaste maten uit nieuwe vrije-voorraadlijst

**Waarom:** Karpi leverde een verse export `Vorraadlijst 29-5-2026.xls` ("Ovz. vrije voorraad — alle artikelen") om de oude test-/importvoorraad te overschrijven met de actuele stand. Afspraak: alleen de **vrije voorraad** meenemen, backorder + reserveringen op 0.

**Wat:** Eenmalig script [`import/update_voorraad_2026_05.py`](../import/update_voorraad_2026_05.py) (dry-run default, `--commit` schrijft).
- **Scope: alleen `product_type='vast'`.** Staaltje (4.134), rol (798) en overig (2.154) bewust ongemoeid — staaltjes worden in een ander project beheerd; rol-voorraad loopt per individuele rol via de rollen-sync (niet via deze artikel-totalen).
- **Sleutel:** kolom `Artikelnr` (kol A) → `producten.artikelnr`. **Waarde:** kolom `Vrije voorraad` (kol H) → `voorraad` + `vrije_voorraad`. Kolom D (bruto Voorraad) bewust niet gebruikt; `backorder`/`gereserveerd` niet gelezen maar hard op 0 gezet.
- **Resultaat (commit):** 17.998 vast geüpdatet · 1.976 rood→0 · 30 niet-in-lijst→0 · **13 nieuwe vaste maten aangemaakt** (incl. ronde kleden `…RND` → `vorm='rond'`, dims uit Karpi-code). Totaal producten 27.077 → **27.090** (+13 netto).
- **0/negatieve voorraad genegeerd (afspraak):** nieuwe artikelen worden alleen aangemaakt bij vrije voorraad > 0 (eerst 116 aangemaakt, daarna 89 met 0 + 14 met negatieve voorraad verwijderd → 13 over). Bestaande `vast`-producten met negatieve vrije voorraad (oversold in oude data) zijn geclampt naar 0 (468 stuks) — `producten.voorraad` mag niet negatief zijn. Script doet dit nu automatisch (`max(0, vrije_voorraad)` + filter nieuw op >0).
- **Rode regels (2.917, rood font in de .xls, A–F):** voorraad→0 én weggeschreven naar [`import/voorraad_uitsluiten.csv`](../import/voorraad_uitsluiten.csv) — skip-lijst voor toekomstige imports (Karpi stuurt later een verwijderlijst). Rode-detectie via `xlrd(formatting_info=True)`, fontkleur RGB (255,0,0).
- **Broadloom-onderscheid:** vaste maat = Karpi-code matcht `^[A-Z]{3,4}\d{2}XX` (XX = scheiding ná kleurcode, incl. `…RND`); broadloom/rol (`…400SYN`, `…300ONG`, jute-runners) heeft geen XX-scheiding en "voorraad" in meters (decimaal). 1.078 nieuwe broadloom-artikelen daarom NIET als stuks aangemaakt, wel gelogd in het rapport.
- **44 nieuwe artikelen zonder kwaliteit-link** (codes `ASLA`, `IBIA` ontbreken in `kwaliteiten`; `kwaliteit_code` op NULL gelaten — FK-guard). Kunnen later verrijkt worden.
- **Rapport:** [`import/rapporten/voorraad_update_2026_05.xlsx`](../import/rapporten/voorraad_update_2026_05.xlsx) (samenvatting, nieuw-vast, broadloom-skip, op-0, rood).
- **Implementatie-noot:** bestaande producten via gegroepeerde `UPDATE … in_(artikelnr)` per voorraadwaarde (geen upsert — die forceert een INSERT en valt op NOT NULL `omschrijving`/`vorm`); nieuwe via `INSERT`. Resterende 133 backorders≠0 zitten allemaal op overgeslagen types (staaltje 113 / overig 16 / rol 4), géén op `vast`.

## 2026-05-31 — Opschoon-script test-data vóór live-gang

**Waarom:** Tot nu toe is met test-orders gewerkt. Vóór de live-gang (echte orders vanaf 2026-06-01) moet de transactionele test-data eruit, terwijl stamdata (klanten, prijslijsten, producten, voorraad, inkoop) blijft staan.

**Wat:** Eenmalig SQL-script [`supabase/scripts/2026-05-31_cleanup_testdata.sql`](../supabase/scripts/2026-05-31_cleanup_testdata.sql) — handmatig in Supabase Studio uit te voeren.
- **Wist** (kind→ouder, in 1 transactie): orders + order_regels + order_reserveringen + order_events + order_documenten (DB-rijen); facturen + factuur_regels + factuur_queue; snijplannen + snijvoorstellen + snijvoorstel_plaatsingen + snijplan_groep_locks; confectie_orders; zendingen + zending_regels + zending_orders + zending_colli + hst_transportorders; scan_events.
- **Behoudt:** debiteuren, prijslijsten, producten, rollen (alleen workflow-status gereset → beschikbaar/reststuk, snijden_* gewist), leveranciers + inkooporders, vervoerders, klanteigen_namen, medewerkers, maatwerk-config, app_config, edi_handelspartner_config. Bewust ongemoeid gelaten: samples, edi_berichten (alleen FK-link naar gewiste orders/facturen op NULL), activiteiten_log, voorraad_mutaties, rol_mutaties, storage-buckets.
- **Voorraad herberekend:** `producten.gereserveerd=0` + `vrije_voorraad=voorraad−backorder` (alle claims weg). `besteld_inkoop` ongemoeid (inkoop blijft).
- **Nummering gereset** zodat echte data bij `0001` begint: sequences `ord/snij/snijv_2026_seq` via `setval(...,1,false)`; FACT/ZEND/SAMP via verwijderen van de `nummering`-rijen. `R` (rolnummers) + SSCC ongemoeid.
- **Trigger-veiligheid:** churn-triggers (herallocatie, order-totalen, reservering-sync) op orders/order_regels/order_reserveringen tijdens de delete uit; FK-cascade + RI blijven actief.
- **Bekende beperking:** echt gesneden test-snijplannen lieten ingekorte moederrollen + reststukken achter die het script NIET terugdraait — bij twijfel verse voorraad-herimport (gedocumenteerd onderaan het script).

## 2026-05-27 — HST-vrachtbrief automatisch aan order gekoppeld (mig 304)

**Waarom:** HST stuurt na een succesvolle POST een base64-PDF mee (`PDFDocument.Contents`, ~14KB) — de vrachtbrief/label. Tot nu toe stripten we die uit `response_payload` om de DB-rij compact te houden, waarmee de PDF effectief weggegooid werd. De gebruiker wil 'm aan de order kunnen koppelen "net als de track en trace": zien op order-detail, downloadbaar.

**Wat:**
- **[Mig 304](../supabase/migrations/304_hst_vrachtbrief_pdf.sql):**
  - `hst_transportorders.pdf_path TEXT` + `pdf_uploaded_at TIMESTAMPTZ` — single source of truth voor de PDF-locatie + tijdstip.
  - `markeer_hst_verstuurd`-signature uitgebreid met `p_pdf_path TEXT DEFAULT NULL, p_pdf_uploaded_at TIMESTAMPTZ DEFAULT NULL` (backwards-compatible).
  - Trigger `fn_hst_pdf_naar_order_documenten` (AFTER INSERT/UPDATE OF pdf_path) → spiegelt automatisch één rij naar `order_documenten` voor de primaire order van de zending, met `bestandsnaam = 'HST-vrachtbrief-{zending_nr}.pdf'`, `omschrijving = 'HST vrachtbrief — OrderNumber T75...'`. Idempotent via `ON CONFLICT (storage_path) DO NOTHING`.
- **[`hst-send/index.ts`](../supabase/functions/hst-send/index.ts):** na succesvolle POST decoder de base64-PDF, uploadt naar `order-documenten/hst-vrachtbrieven/{zending_nr}.pdf` (bucket uit mig 178, hergebruik), geeft pad mee aan `markeer_hst_verstuurd`. Helper `uploadPdf` is best-effort — een mislukte upload mag het HST-succes niet ongedaan maken (POST is al gelukt; we loggen en gaan door).
- **Nul UI-werk**: `<DocumentenCompact kind="order" parentId={order.id} />` op [order-detail.tsx](../frontend/src/pages/orders/order-detail.tsx) leest al `order_documenten` en biedt download via bestaande `getDocumentSignedUrl`-helper. De vrachtbrief verschijnt dus automatisch in de bestaande documenten-widget, naast eventuele user-uploads (klant-PO, etc.).

**Scope-keuze:** V1 koppelt aan **één** order per zending (de primaire — meest voorkomend, 1-op-1). Voor bundle-zendingen (mig 222) ziet alleen de primary order de PDF in DocumentenCompact; andere bundle-orders bereiken 'm via de zending-pagina. Bundle-fan-out = V2-backlog. Reden: `order_documenten.storage_path UNIQUE` blokkeert duplicate-koppeling — die globale uniqueness niet doorbreken voor één edge case.

**Toepassen:** mig 304 handmatig in Supabase Studio + edge function deployen (`npx supabase functions deploy hst-send`).

## 2026-05-27 — HST-koppeling: SSCC-koppeling per colli + depotnummer op shipping-label

**Waarom:** Na de Fase-0 rondreis was duidelijk dat HST onze sticker scant en daar via de barcode aan hun TransportOrder (`OrderNumber=T75...`) moet koppelen. De eerste builder-versie stuurde één aggregate-regel met **lege** `BarCode` — dan kan HST's scanner ons label nergens aan matchen en blijft de Karpi-Zebra-label een losse "papierprint" die niets traceert. Tegelijk eist Thom ten Brinke (HST, 2026-02-26) een **scanbare barcode + depotnummer rechtsboven** op het label.

**Wat:**
- **Builder per-colli i.p.v. aggregate** ([`payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts)): één `TransportOrderLines`-entry per `zending_colli`-rij, elk met `Quantity=1`, eigen `Weight`, `GoodsDescription` uit `omschrijving_snapshot` en `BarCode={ BarCode: "00${sscc}" }` (GS1 AI(00) prefix + 18-cijferige SSCC). Top-level `HasBarcode: true` vertelt HST dat wij de labels printen. Fallback naar aggregate-regel + `HasBarcode: false` als er onverwacht geen colli's zijn — defensief, niet de happy path.
- **Edge function guard** ([`hst-send/index.ts`](../supabase/functions/hst-send/index.ts)): nieuwe `zending_colli`-query vóór `bouwTransportOrderPayload`. Géén colli's → `markeer_hst_fout` met expliciete reden (geen POST gedaan); voorkomt onkoppelbare orders bij HST.
- **Types uitgebreid** ([`types.ts`](../supabase/functions/hst-send/types.ts)): nieuwe `ZendingColliInput` + optionele `HasBarcode` op `HstTransportOrderPayload`.
- **Tests bijgewerkt** ([`payload-builder.test.ts`](../supabase/functions/hst-send/payload-builder.test.ts)): per-colli happy path, lege-colli fallback, lege-adres edge case, `splitAdres`. 4/4 groen.
- **Zebra-label rechtsboven** ([`shipping-label.tsx`](../frontend/src/modules/logistiek/components/shipping-label.tsx)): conditional — toon `zending.track_trace` (HST's OrderNumber, bv. `T75038267000180`) als depotnummer in monospace + bold; alleen voor zendingen die al een track_trace hebben (= HST-zendingen ná markeer_hst_verstuurd). Voor andere vervoerders blijft "7122 LB Aalten" zoals nu.

**Flow-volgorde** (bevestigd, geen migratie nodig): `start_pickronden_unified` (mig 248) → `genereer_zending_colli` (mig 209/213) — colli's bestaan dus altijd vóór de status-flip naar "Klaar voor verzending" en de daaropvolgende HST-trigger. De edge-function guard is defense-in-depth voor edge cases zoals direct-aangemaakte zendingen die de pickronde overslaan.

**Print-volgorde implicatie:** Karpi-Zebra-label hoort **na** de HST-respons geprint te worden zodat het depotnummer ingevuld is. Pickronde-flow doet dat al impliciet (post is een seconde-werk via cron). Bij herprint vóór HST-respons komt er gewoon "7122 LB Aalten" rechtsboven — geen blocker, maar minder optimaal voor de chauffeur.

## 2026-05-27 — HST-koppeling Fase 0 voltooid: live rondreis tegen ACCP geslaagd

**Waarom:** De `hst-send` edge function + payload-builder waren in 2026-05-01 gebouwd op basis van een *placeholder*-payload — een redelijke gok bij gebrek aan de werkelijke HST OpenAPI-shape. Plan-document markeerde Fase 0 (live curl-rondreis tegen ACCP-omgeving) als blokkerend voor verdere uitrol. Op 2026-05-27 leverde Niek Zandvoort (HST) nieuwe ACCP-credentials (`karpi_api_user` / CustomerID `038267`) + een echt voorbeeld-request via mail.

**Wat:**
- **Live rondreis geslaagd**: POST `https://accp.hstonline.nl/rest/api/v1/TransportOrder` met het door HST aangeleverde voorbeeld-payload → **HTTP 201**, response `{ Success: true, OrderNumber: "T75038267000180", PDFDocument.Contents: <base64-PDF ~14KB> }`. Daarmee zijn endpoint, credentials én happy-path bevestigd.
- **Werkelijke HST-shape verschilt fundamenteel** van onze placeholder: PascalCase, `TransportOrderLines[]` (per regel `Length/Width/Height/Weight/PackageUnitID`), `ToAddress`/`FromAddress` (met `Street`/`StreetNumber`/`StreetNumberAddition` apart), `ShippingServices[]`, top-level `CustomerID`. Response gebruikt `OrderNumber` als tracking-veld (geen `transportOrderId`/`trackingNumber`).
- **Verticale slice herschreven** naar werkelijke shape:
  - [`types.ts`](../supabase/functions/hst-send/types.ts) — `HstTransportOrderPayload`, `HstAddress`, `HstTransportOrderLine`, `HstShippingService`, `HstTransportOrderResponseBody` in PascalCase + optionele velden uit OpenAPI (PickupDate/Douane/WhoNumber/etc.) als toekomst-uitbreiding.
  - [`payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts) — bouwt nieuwe shape uit `ZendingInput`/`OrderInput`/`BedrijfInput`. Nieuwe `splitAdres` helper splitst "Tweede Broekdijk 10 A" → `{ Street, StreetNumber, StreetNumberAddition }`. Defaults voor velden die V1 nog niet heeft (pallet-afmetingen, `OrderType=DELIVERY_LARGE`, `ShippingServiceID=FFBL`, `PackageUnitID=SP`, `GoodsDescription=Tapijten`) bovenaan als constant — vervangen zodra Pick & Ship per-zending afmetingen levert.
  - [`hst-client.ts`](../supabase/functions/hst-send/hst-client.ts) — `OrderNumber`-extractie i.p.v. `transportOrderId`-gok. PDF-base64 wordt **gestript** uit `response_payload` vóór DB-opslag (placeholder met char-length), zodat `hst_transportorders`-rijen compact blijven. Echte PDF (vrachtbrief) opslaan in storage komt in fase 2. Defensief `Success=false` → behandeld als foutpad.
  - [`payload-builder.test.ts`](../supabase/functions/hst-send/payload-builder.test.ts) — 3 nieuwe Deno-tests (happy path, lege afleveradres-fallback, `splitAdres`-cases). Alle 3 groen.
  - [`fixtures/`](../supabase/functions/hst-send/fixtures/) — echte HST request-fixture (uit mail-bijlage Niek) + response-fixture (uit live call, PDF base64 weggelaten). README beschrijft bekende enum-waarden (`DELIVERY_LARGE`/`FFBL`/`SP`) + nog uit te voeren negative-paden.
- **`.env.example`** bevat nu de definitieve ACCP-username + CustomerID als comment.

**Niet meer in dit plan-fase:** tweede live test met onze gegenereerde builder-output is voorbereid (`fixtures/example-karpi-generated-request.json`) maar nog niet uitgevoerd — auto-mode classifier vereist expliciete autorisatie voor herhaalde externe POSTs. Operator kan in 1 minuut zelf draaien (zie plan §Fase 0).

**Vervolg:** Fase 1-onwards uit plan ([`2026-05-01-logistiek-hst-api-koppeling.md`](superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md)) is grotendeels al gebouwd (mig 169-175, frontend logistiek-module). End-to-end test via UI ("Zending aanmaken" → trigger → cron) kan nu met vertrouwen door tegen ACCP-omgeving.

## 2026-05-27 — Order-regel omschrijving: rijke producten-naam behouden + maatwerk klant-eigen naam-lookup

**Waarom:** Bij het toevoegen van een standaard regel werd de rijke `producten.omschrijving` (bv. `"MARICH Kleur 22 CA: 160x230 cm"`) overschreven door de klant-eigen kwaliteitsnaam (bv. `"GENUA"`), waardoor de afmeting in de form verdween. Tegelijk kregen maatwerk-regels nooit de klant-eigen naam in de blauwe sub-tekst (er was geen `fetchKlanteigenNaam`-lookup in `handleAdd`), terwijl standaard regels die wél toonden — inconsistent gedrag tussen beide flows.

**Wat:**
- [`order-line-editor.tsx`](../frontend/src/components/orders/order-line-editor.tsx#L535) — `omschrijving` blijft voortaan altijd `article.omschrijving` (rijke producten-naam, met afmeting). De klant-eigen naam staat al in `klant_eigen_naam` (display-only) en wordt apart als blauwe sub-tekst gerenderd op de regel — niet meer overschreven.
- [`kwaliteit-first-selector.tsx`](../frontend/src/modules/maatwerk/components/kwaliteit-first-selector.tsx) — `handleAdd` is nu `async` en doet `fetchKlanteigenNaam(debiteurNr, kwaliteit_code, kleur_code)` zodat de maatwerk-regel óók een `klant_eigen_naam`-veld krijgt (zelfde blauwe sub-tekst als standaard). Tevens: afmeting (`250x180 cm` of `Ø200 cm`) toegevoegd aan de maatwerk-omschrijving zelf, zodat PDF/EDI consistent zijn met standaard-regels die de afmeting al in `producten.omschrijving` hebben.

**Trade-off:** klant-eigen naam wordt momenteel NIET op `order_regels` opgeslagen (alleen `omschrijving`). De oude override stopte de klant-naam in `omschrijving` zodat PDF/EDI 'm zag — die route is nu weg. Bewust geaccepteerd in deze pass; als PDF/EDI alsnog de klant-naam moet tonen volgt een aparte mig met `klant_eigen_naam_snapshot`-kolom op `order_regels`.

## 2026-05-27 — Tapijt-stickers ook bij standaard-artikelen (per-klant opt-in, mig 303)

**Waarom:** Maatwerk-orders krijgen sinds mig 295/300 een klant-facing tapijt-sticker (148×106mm, met logo + kwaliteit + poolmateriaal + kleur + afmeting + EAN + verzendweek) die tijdens het snijden geprint wordt en op het tapijt geplakt wordt vlak vóór verzending. Een aantal klanten wil diezelfde sticker óók op standaard (niet-maatwerk) catalogus-rollen. Tot nu toe was dat niet mogelijk: bij standaard-artikelen liep er geen snijplan-flow, dus ook geen sticker-print.

**Wat:**
- **Per-klant voorkeur** `debiteuren.tapijt_sticker_bij_standaard BOOLEAN` (default FALSE) in [mig 303](../supabase/migrations/303_tapijt_sticker_bij_standaard.sql). Toggle staat op de debiteur-detail-pagina naast Deelleveringen — operator kan per klant aan/uit zetten.
- **View `zending_regel_sticker_data`** (mig 303) — spiegelt qua kolom-shape `snijplan_sticker_data` (mig 295/300) maar gevoed uit `zending_regels → order_regels → producten → kwaliteiten` voor niet-maatwerk regels. EXCLUDED: maatwerk-regels (hebben eigen snijplan-sticker), administratieve regels (verzendkosten via `is_admin_pseudo`), en producten zonder kwaliteit_code/kleur_code (toebehoren/ondertapijt). Klanteigen kwaliteits-naam via `resolve_klanteigen_naam` + EAN via `sticker_ean_voor_kw_kl` — identieke resolutie-keten als maatwerk-sticker.
- **`StickerRenderData`-interface** in [sticker-layout.tsx](../frontend/src/components/snijplanning/sticker-layout.tsx) — minimaal subset (`Pick<StickerData, ...>`) zodat dezelfde `StickerLayout`-component zonder vertakking wordt hergebruikt voor maatwerk- en standaard-stickers. Geen wijziging aan layout, kleur, font of mm-posities — exact zoals nu.
- **Hooks** `useZendingStickerData` / `useZendingStickerDataBulk` in [use-zending-stickers.ts](../frontend/src/modules/logistiek/hooks/use-zending-stickers.ts). Queries in [zending-stickers.ts](../frontend/src/modules/logistiek/queries/zending-stickers.ts).
- **Print-pagina's** [`zending-printset.tsx`](../frontend/src/modules/logistiek/pages/zending-printset.tsx) + [`bulk-printset.tsx`](../frontend/src/modules/logistiek/pages/bulk-printset.tsx):
  - Checkbox "Tapijt-stickers meeprinten (N)" verschijnt bij niet-maatwerk regels; default uit klant-voorkeur.
  - Aparte knop "Tapijt-stickers" om alleen die te printen (148×106mm, andere papierrol dan Zebra-labels).
  - "Alles"-knop includeert tapijt-stickers ALS checkbox aanstaat (anders verborgen via CSS).
  - Nieuwe `@page tapijt-sticker { size: 148mm 106mm; margin: 0 }` regel naast bestaande `shipping-label` (76.2×50.8mm Zebra) en `pakbon` (A4) — drie page-sizes naast elkaar, browser kiest per element via `page:`-property scoped op `.tapijt-stickers .sticker-label`.
  - Per `zending_regel` `aantal × 2` stickers: Sticker tapijt + Sticker orderdossier, identiek aan de maatwerk-bulk-pagina (`stickers-bulk.tsx`).

**Out of scope:** geen retroactieve sticker-print voor reeds verzonden zendingen — de operator print op het moment van de pickronde. Maatwerk-regels in dezelfde zending krijgen géén dubbele sticker; die lopen via de snijplanning-flow (mig 295). Wijziging in de StickerLayout zelf was bewust niet gewenst ("qua opbouw exact hetzelfde blijven").

**Follow-up fix in dezelfde sessie — lege pagina's tussen stickers:** de bestaande maatwerk-stickers-bulk-pagina (en de single-sticker-pagina) hadden een latente bug: per sticker werd een extra blanco pagina geproduceerd. Root cause: de screen-only sub-titel (`Sticker tapijt` / `Sticker orderdossier`) gebruikte alleen `print:hidden` van tailwind. In het Edge-print-pad waar `@media print` om een onbekende reden niet volledig firede bleef die span ~5mm hoog, waardoor de wrapper 111mm werd op een 106mm `@page` → 1 sticker liep over 2 pagina's. Fix: (1) `sticker-wrapper`-class op de `StickerLayout`-root zodat CSS scherp kan targeten; (2) belt-and-suspenders `.sticker-wrapper > span { display: none !important }` in elke print-css als backup naast `print:hidden`; (3) DOM platten in [stickers-bulk.tsx](../frontend/src/pages/snijplanning/stickers-bulk.tsx) zodat alle stickers direct children van `.sticker-print-area` zijn — daardoor werkt `> *:not(:last-child) { break-after: page }` netjes (geen trailing blanco-pagina meer); (4) `page-break-after: always` op élke `.sticker-label` is vervangen door de tussen-wrappers-pattern zodat alleen TUSSEN stickers gebroken wordt; (5) instructie-banner toegevoegd over papierformaat 148×106mm + "Laat de app mijn afdrukvoorkeuren wijzigen" voor de oude Edge-dialoog (de "te dicht bij randen via afbeelding 2"-melding van de operator was een dialog-quirk, niet oplosbaar in CSS). Dezelfde fix is preventief toegepast op de nieuwe tapijt-stickers-sectie in [zending-printset.tsx](../frontend/src/modules/logistiek/pages/zending-printset.tsx) en [bulk-printset.tsx](../frontend/src/modules/logistiek/pages/bulk-printset.tsx).

## 2026-05-27 — Vervoerder-sticker layout-rebuild + print-bug fix (Zebra 76.2×50.8mm)

**Waarom:** De gebruiker liet een fysieke referentie-sticker (Rhenus) zien naast de huidige browser-print-preview. Twee problemen: (1) de sticker werd over twéé pagina's afgedrukt — onbruikbaar voor de magazijnier; (2) de layout matchte niet met het referentie-ontwerp uit het oude systeem. Bij doorvragen bleek dat de Zebra ZD420-printer op **76.2 × 50.8 mm** (3"×2") rollen staat — onze defaults stonden op 105×60mm, waardoor de inhoud sowieso niet binnen het fysieke label paste.

**Wat:**
- **Default label-formaat** in [printset.ts](../frontend/src/modules/logistiek/lib/printset.ts) van 105×60mm → **76.2×50.8mm** (Zebra 3"×2"-standaard). Per-vervoerder afwijkende formaten blijven uit `vervoerders.label_breedte_mm/label_hoogte_mm` komen.
- **Layout-rebuild** in [shipping-label.tsx](../frontend/src/modules/logistiek/components/shipping-label.tsx) — 3 rijen × 2 kolommen die het referentie-ontwerp volgen, compact ingericht op 76.2×50.8mm:
  - Rij 1: links order-nr + uw-ref op één regel + productnaam prominent (uppercase, vet) | rechts Karpi BV-afzender + zending-nr klein.
  - Rij 2: links afleveradres in een dik (2px) zwart kader, zonder "AFLEVERADRES"-tag-label | rechts vervoerder-badge gecentreerd in zwart kader.
  - Rij 3: links Code128-barcode + cijfers eronder | rechts colli `X VAN Y` prominent, daaronder "REFERENTIE" + datum (`DD/MM/YY`) + oud-order-nr in mono-font.
- **Print-bug fix**: `.shipping-label` in print-CSS van [zending-printset.tsx](../frontend/src/modules/logistiek/pages/zending-printset.tsx) en [bulk-printset.tsx](../frontend/src/modules/logistiek/pages/bulk-printset.tsx) krijgt nu `break-inside: avoid` + `page-break-inside: avoid` (browser-compatibiliteit) + `box-sizing: border-box` + `overflow: hidden`. Voorkomt dat sub-pixel-overflow het label over twee @page-pagina's verspreidt.
- **Dynamisch label-formaat**: `ShippingLabel` accepteert nu een optionele `labelFormaat`-prop. Beide printset-pagina's geven het uit `labelFormaatVoor(zending)` door, zodat het label-element dezelfde mm-afmetingen krijgt als de `@page shipping-label`-size — voorheen was de div hardcoded 105×60mm ongeacht de vervoerder-instelling.
- **Datum-formaat** veranderd van `toLocaleDateString('nl-NL')` (`27-5-2026`) naar handmatig `DD/MM/YY` (`27/05/26`) zoals op de referentie.

**Root cause van de split-print-bug:** Chrome's print-dialoog hanteert standaard ~8mm marges op elke zijde, óók als je `@page { margin: 0 }` declareert in CSS. Op een 50.8mm-hoog label geeft dat maar 34.8mm bruikbare ruimte → label breekt over 2 pagina's. De **enige fix** is dat de operator in de print-dialoog onder "Meer instellingen" → "Marges" → **Geen** kiest. Daarom staat er nu een prominente gele waarschuwingsbalk bovenaan de verzendset-pagina met deze instructie.

**Niet-fix CSS-aanpassingen (defense-in-depth, hielpen niet bij de root cause maar wel bij robustness):**
- Absolute positioning per cel ipv CSS grid in [shipping-label.tsx](../frontend/src/modules/logistiek/components/shipping-label.tsx) — voorkomt dat content overflow de outer container kan duwen.
- `break-inside: avoid !important` + `page-break-inside: avoid !important` op zowel `.shipping-label` als alle children.
- `contain: layout paint size` voor browser-hint dat het label een gesloten layout-blok is.
- Label fysiek 0.5mm kleiner dan @page voor sub-pixel rounding-marge.
- Page-break TUSSEN labels in plaats van NA elk label (`.shipping-label + .shipping-label { break-before: page }`) — voorkomt een lege vervolgpagina op de Zebra-rol bij solo-zendingen.

**Out of scope:** "OMB"-marker uit de referentie (vermoedelijk Karpi-interne afkorting voor omboeking) — nog niet helder welk veld dat triggert; wordt toegevoegd zodra de bron-data bekend is. Productnaam-logica ongewijzigd: blijft `order_regels.omschrijving` + optioneel `producten.omschrijving` als die afwijkt — past dezelfde regel toe als voorheen, alleen visueel groter weergegeven.

## 2026-05-21 — Bulk-status-wijziging + datum-range-filter op facturen-overzicht

**Waarom:** Na de status-edit per factuur (vorige entry) miste nog de schaal-oplossing: bij maandafsluiting wil je 50 Concept-facturen in één klik op Verstuurd zetten, of een hele week aan facturen op Betaald markeren. Eén-voor-één klikken op detail is dan ondoenlijk. Ook miste een datum-range-filter op het overzicht — handig om eerst de juiste subset te isoleren voordat je bulk-acties uitvoert.

**Wat:**
- **Datum-range-filter** in [facturatie-overview.tsx](../frontend/src/modules/facturatie/pages/facturatie-overview.tsx): twee `<input type="date">`-velden (Van / Tot) naast de bestaande status- en klant-filters. Vergelijking op ISO-strings (factuurdatum is `DATE`, input-value is `YYYY-MM-DD` → lexicaal = chronologisch). Wis-knop verschijnt zodra ≥1 datum is ingevuld.
- **Selectie-state** in de overview: `Set<number>` met `toggle` (per rij), `toggleAlles` (zichtbare ids op/uit), `clearSelectie`. `FactuurLijst` accepteert nu optionele `selectie`, `onToggle`, `onToggleAlles`-props; zonder die props blijft het component identiek aan voorheen (backwards-compat voor [klant-detail.tsx](../frontend/src/pages/klanten/klant-detail.tsx) en andere call-sites). Checkbox-kolom verschijnt links; header-checkbox heeft tri-state (uit / indeterminate / aan).
- **Nieuwe query** `zetFactuurStatusBulk(ids, status)` in [queries/facturen.ts](../frontend/src/modules/facturatie/queries/facturen.ts) — `UPDATE facturen SET status WHERE id IN (...)`. Skip bij lege array zodat een lege Set geen UPDATE-all-rows zonder WHERE riskeert.
- **Hook** `useZetFactuurStatusBulk` in [hooks/use-facturen.ts](../frontend/src/modules/facturatie/hooks/use-facturen.ts) — zelfde cache-invalidatie als de single-mutatie.
- **Component** [`FactuurBulkBalk`](../frontend/src/modules/facturatie/components/factuur-bulk-balk.tsx): terracotta-getinte balk die verschijnt zodra selectie > 0. Toont aantal, dropdown met 6 statussen (gekleurde badges), en wis-knop. `window.confirm` vóór de mutatie — laagdrempelig, géén onomkeerbare delete dus geen volle modal nodig. Loading-state vergrendelt de knoppen tijdens save.

**Out of scope:** geen optimistic update (cache wordt na success vol opnieuw opgehaald). Geen "selecteer alles inclusief niet-zichtbare" — bewust: bij actieve datum-filter zou anders je hele archief geraakt kunnen worden. Geen undo — operator moet de transitie zelf terugdraaien als hij fout heeft geklikt.

## 2026-05-21 — Factuur-status handmatig wijzigen op detail-pagina

**Waarom:** De UI bood alleen "Markeer als betaald" (Concept → Betaald). Operators konden geen correctie doen naar Verstuurd / Herinnering / Aanmaning / Gecrediteerd vanuit de UI — die statussen werden uitsluitend gezet door [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts) (Verstuurd na e-mail) of bleven onbereikbaar. Bij een handmatig verstuurde factuur, een credit-correctie of een betalingsherinnering moest de status nu via SQL omgezet worden.

**Wat:**
- **Nieuwe query** `zetFactuurStatus(id, status)` in [queries/facturen.ts](../frontend/src/modules/facturatie/queries/facturen.ts) — directe `UPDATE facturen SET status=…` (geen RPC nodig; de tabel staat directe updates al toe zoals de bestaande `zetFactuurOpBetaald`-flow uit dezelfde file).
- **Hook** `useZetFactuurStatus` in [hooks/use-facturen.ts](../frontend/src/modules/facturatie/hooks/use-facturen.ts) — invalideert `['facturen']` zodat overzicht én detail meebewegen.
- **Component** [`FactuurStatusSelect`](../frontend/src/modules/facturatie/components/factuur-status-select.tsx): klikbare StatusBadge + chevron, opent een popover met alle 6 enum-waardes als gekleurde badges. Buiten-klik sluit, huidige status krijgt een check-icoon, mutatie disable't de knop tijdens save.
- **Integratie** in [factuur-detail.tsx](../frontend/src/modules/facturatie/pages/factuur-detail.tsx): de status-rij in de Factuurgegevens-card vervangt de read-only `StatusBadge` door `FactuurStatusSelect`. De "Markeer als betaald"-knop in de header blijft staan als snelkoppeling voor de meest gebruikte transitie.

**Out of scope:** geen audit-trail / `order_events`-koppeling — facturen hebben (nog) geen eigen event-log. Geen `verstuurd_op`-automatiek bij handmatig Concept → Verstuurd; die kolom blijft alleen gezet door `factuur-verzenden`.

## 2026-05-21 — Verkoopoverzicht-export (AFAS-import format, mig 302)

**Waarom:** Het oude ERP genereerde een tab-separated `.XLS` met factuur-overzicht per datum-range (filename `VERK_OVERZICHT_VAN_{YYYYMMDD}_TOT_{YYYYMMDD}.XLS`) die ingelezen werd in AFAS voor financiële boekhouding. RugFlow had nog geen equivalent — operator moest terugvallen op het oude systeem voor maandelijkse facturen-exports.

**Wat:**
- **Migratie 302** ([supabase/migrations/302_verkoopoverzicht_export_view.sql](../supabase/migrations/302_verkoopoverzicht_export_view.sql)): nieuwe view `verkoopoverzicht_export`. Per factuur 1 rij met debiteur-snapshot uit `debiteuren` (niet `facturen.fact_*` — die snapshot kan afwijken van actuele klant-data), gekoppelde ordernummers + klant-referenties (DISTINCT samengevoegd met `; ` voor bundel-facturen die meerdere orders dekken — AFAS-import veld), en factuur-totalen. View bevat álle statussen; frontend-side filter beperkt tot `Verstuurd/Betaald/Herinnering/Aanmaning` (Concept en Gecrediteerd uit). Naam2 wordt afgeleid uit `debiteuren.inkoopgroep_code` (bv. `(INKC02 DECOR UNION)`) voor klanten in een inkoopgroep — vervangt de oude "(ZR-NR ...)"-tags uit het legacy-systeem.
- **Frontend-builder** ([frontend/src/modules/facturatie/lib/verkoopoverzicht-xls.ts](../frontend/src/modules/facturatie/lib/verkoopoverzicht-xls.ts)): genereert bit-compatibele output — tab-separator, LF line-endings (geen CRLF), ISO-8859-1 encoding via custom byte-mapper (Windows-1252-extensies voor `€` `–` `—` etc.), postcode pad-right naar 7 chars, bedragen Nederlands geformatteerd (puur integer als rond, anders `1234,56`), datum `DD-MM-YYYY`, vervaldatum `Onbekend!`-fallback, land-mapping (`NL` → leeg, `BE` → `België`, etc.).
- **Query-helper** ([queries/verkoopoverzicht.ts](../frontend/src/modules/facturatie/queries/verkoopoverzicht.ts)): `fetchVerkoopoverzicht(van, tot)` — `BETWEEN`-filter op `factuurdatum`, sorteert op `debiteur_nr ASC`, `factuur_nr ASC`.
- **Dialog** ([components/verkoopoverzicht-export-dialog.tsx](../frontend/src/modules/facturatie/components/verkoopoverzicht-export-dialog.tsx)): twee date-inputs (default = vandaag), status-indicator (aantal facturen na succesvolle export, foutmelding bij lege range of fout). Triggert browser-download van `.XLS`-blob met `application/vnd.ms-excel`-MIME zodat Excel het direct als sheet opent.
- **Knop** in [facturatie-overview.tsx](../frontend/src/modules/facturatie/pages/facturatie-overview.tsx): nieuwe action-knop "Verkoopoverzicht" rechts naast de pagina-titel.

**Open backlog:** AFAS-mapping nog niet getest op een real-world import (operator moet 1× een echte file door AFAS heen halen om kolom-mapping te bevestigen). Mogelijk verschilt het AFAS-veld voor "Ordernummer" als concat — fallback is een 1-regel-per-(factuur × order)-modus in een v2 van de export.

## 2026-05-20 — Fix: packer plaatste stukken op al-snijdende rollen (mig 301)

**Waarom:** Op rol VERR130 C lagen 4 maatwerk-stukken op fysiek overlappende posities — Zitmaxx (250×450) op (0,0), Headlam (325×225 geroteerd) óók op (0,0), Floorpassion op (0,225), Gero op (235,225). De UI clusterde ze daardoor terecht in één Rij 1 met messen 235/250/325 en lengte-mes 450, maar de operator kan deze layout fysiek niet snijden. Som van de 4 stukken (276.050 cm²) past niet in een 400×450-vlak (180.000 cm²) — onbetwistbaar bewijs dat de packer iets fout heeft gedaan.

**Root cause:** Een tweede `auto-plan-groep`-run (na toevoeging van Gero) zag VERR130 C als beschikbare rol terwijl Zitmaxx er al fysiek op lag. `fetchBeschikbareRollen` sluit weliswaar rollen met `snijden_gestart_op IS NOT NULL` uit ([db-helpers.ts:161](../supabase/functions/_shared/db-helpers.ts#L161)), maar tussen het promoveren van snijplannen naar `'Snijden'` en het zetten van `rollen.snijden_gestart_op` bestaat een window waarin de rol toch in de pool zit. `fetchBezettePlaatsingen` filtert daarbij alléén op `status='Gepland'` ([db-helpers.ts:281](../supabase/functions/_shared/db-helpers.ts#L281)), dus de packer kreeg een lege bezetteMap voor VERR130 C en plaatste de 3 nieuwe stukken alsof de rol leeg was. Zitmaxx zijn (0,0) bleef onaangeroerd → fysieke overlap.

**Wat:**
- **Code-fix** in [`fetchBeschikbareRollen`](../supabase/functions/_shared/db-helpers.ts): extra defense-in-depth-guard — rollen met ANY snijplan in `('Snijden', 'Gesneden')` worden hard uit de planning-pool gefilterd, ook als `rollen.snijden_gestart_op` (nog) NULL is. Bestaande filter blijft staan; nieuwe is een additionele zekering tegen status-window-drift. Commentaar bij `fetchBezettePlaatsingen` aangescherpt zodat het verband tussen de twee filters expliciet is.
- **Migratie 301** ([supabase/migrations/301_herstel_verr130c_overlap.sql](../supabase/migrations/301_herstel_verr130c_overlap.sql)): idempotente data-fix die de 3 niet-Zitmaxx-snijplannen op VERR130 C verplaatst naar hun fysiek-correcte Y-posities (Headlam → y=450, Floorpassion → y=675, Gero → y=675 lane 2). Guard checkt eerst of de bekende foutieve posities nog in de DB staan voordat hij update — operator-edits blijven veilig.
- **Geen wijziging aan derive.ts / packer-algoritme zelf** — die werken correct gegeven de input; de bug zat in welke rollen de packer aangeboden kreeg.

**Open backlog:** investigeren of `start_snijden_rol` atomair `rollen.snijden_gestart_op` + `snijplannen.status='Snijden'` in één transactie zet (anders blijft de window-race-mogelijkheid bestaan, alleen niet meer schadelijk dankzij de nieuwe guard). Toetsen of er nog meer rollen in productie zijn waarop al overlap is ontstaan: `SELECT rol_id, COUNT(*) FROM snijplannen WHERE status IN ('Snijden','Gesneden') GROUP BY rol_id, positie_x_cm, positie_y_cm HAVING COUNT(*) > 1`.

## 2026-05-20 — Deadline-bewuste claim-swap (ADR-0027 / mig 297-299)

**Waarom:** Karpi-B2B-klanten communiceren regelmatig "geen haast, lever pas wk 40" terwijl de standaard-leverweek voor dat product wk 1 zou zijn. Vandaag claimde [`herallocateer_orderregel`](../supabase/migrations/154_uitwisselbaar_claims.sql) (mig 154) gulzig voorraad voor zo'n order, waarna een latere urgente order met afleverdatum wk 21 op IO moest wachten en deadline miste. Optimale uitkomst was geweest: late order → IO (past binnen wk 40), urgente order → voorraad. De [[Claim-volgorde-prio]]-invariant ("wie eerst claimt wordt eerst beleverd") krijgt daarom één **gerichte uitzondering**.

**Wat:**
- **ADR-0027** ([docs/adr/0027-deadline-bewuste-claim-swap.md](adr/0027-deadline-bewuste-claim-swap.md)) — vijf ingrepen: swap-fase in allocator, EDD-bron-selectie, laatst-passende IO-keuze, dubbele `order_events`-audit-trail, alarm-only bij IO-vertraging-na-swap (géén automatische reverse-swap, géén cascade — beide V2).
- **Domeinconcept:** [[Claim-swap]] toegevoegd in [data-woordenboek.md](data-woordenboek.md); [[Claim-volgorde-prio]] herformuleerd met de uitzondering. Geen nieuwe kolommen op `orders`/`order_regels`/`order_reserveringen` — hergebruikt bestaande `afleverdatum` (operator-input) en `standaard_afleverdatum_berekend` (snapshot uit ADR-0020).
- **Migratie 297** ([supabase/migrations/297_claim_swap_allocator.sql](../supabase/migrations/297_claim_swap_allocator.sql)): `herallocateer_orderregel` uitgebreid met swap-fase tussen voorraad-claim en IO-fallback. Selectie-criteria: A.`afleverdatum > standaard_afleverdatum_berekend`, voorraad-only (geen IO-mix), `is_handmatig=false` (mig 154-respect). EDD-volgorde (`A.afleverdatum DESC`) bij meerdere kandidaten, laatst-passend IO (`verwacht_datum DESC` binnen `buffer + verwacht ≤ A.afleverdatum`). Trigger `trg_io_regel_insert_swap_evaluate` op `inkooporder_regels` INSERT: heralloceert wachtende orderregels met effectief tekort (alleen status `'Wacht op voorraad'` — geen cascade in V1). Drie enum-waarden toegevoegd aan `order_event_type`: `claim_geswapt_weg`, `claim_geswapt_naar`, `deadline_conflict_na_swap`.
- **Migratie 298** ([supabase/migrations/298_claim_swap_conflict_detect.sql](../supabase/migrations/298_claim_swap_conflict_detect.sql)): `sync_order_afleverdatum_met_claims` (mig 153) emit nu `deadline_conflict_na_swap`-event als post-swap-vertraging de `afleverdatum` voorbij `standaard_afleverdatum_berekend` duwt op een order die eerder een `claim_geswapt_weg`-event kreeg. 24u-dedup-window voorkomt event-spam. Geen automatische reverse-swap — operator-actie verwacht.
- **Migratie 299** ([supabase/migrations/299_claim_swap_rls_security.sql](../supabase/migrations/299_claim_swap_rls_security.sql)): SELECT-policy op `order_events` voor `authenticated` (anders is de chip onzichtbaar) + SECURITY DEFINER op `herallocateer_orderregel`, `sync_order_afleverdatum_met_claims`, `trg_io_regel_insert_swap_evaluate` (anders RLS-fout 42501 bij trigger-fire). Volgt het mig 218_z-patroon.
- **Frontend Order-detail:** nieuwe `<OrderEventsTijdlijn>` in [components/orders/order-events-tijdlijn.tsx](../frontend/src/components/orders/order-events-tijdlijn.tsx), aangehangen op [pages/orders/order-detail.tsx](../frontend/src/pages/orders/order-detail.tsx). Toont swap- en deadline-conflict-events met klikbare link naar tegen-order. Nieuwe `useOrderEvents`-hook in [modules/orders-lifecycle/hooks/use-order-events.ts](../frontend/src/modules/orders-lifecycle/hooks/use-order-events.ts) + typed `OrderEvent` discriminated union in [queries/order-events.ts](../frontend/src/modules/orders-lifecycle/queries/order-events.ts).
- **Frontend Orders-overview:** rode "Deadline-conflict"-chip naast ordernummer in [orders-table.tsx](../frontend/src/components/orders/orders-table.tsx) voor orders met `deadline_conflict_na_swap`-event in laatste 30 dagen. Per-pagina-batch geaggregeerd in [queries/orders.ts](../frontend/src/lib/supabase/queries/orders.ts) (geen N+1).
- **Tests:** contract-fixtures in [modules/reserveringen/lib/__tests__/swap-policy.test.ts](../frontend/src/modules/reserveringen/lib/__tests__/swap-policy.test.ts) — 6 swap-scenarios + 3 conflict-scenarios als data-contract, 9 `it.todo`-markers voor toekomstige integratie-runner (vereist lokale Supabase-test-database).
- **Review-fixes (mig 297 + 299):** code-reviewer agent vond 5 kritieke issues vóór merge — A1 (RLS SELECT ontbrak), A2 (RPC's niet SECURITY DEFINER), A3 (`is_handmatig`-filter ontbrak), A4 (foutieve metadata-ADR-tags), A5 (trigger-scope op `'Wacht op inkoop'` creëerde cascade). Allemaal gefixt vóór toepassing.

**Open backlog (V2):** cascade-swap (>1 stap), reverse-swap bij IO-vertraging, multi-source-orders als swap-bron, spoed-overrides op IO-claims onderling, configureerbare `swap_minimum_marge_dagen`, actiever signaal bij deadline-conflict (Slack/mail), per-klant `default_uiterste_marge_weken`.

## 2026-05-20 — Bruto-maatwerkvraag op Rollen & Reststukken (ADR-0026 / mig 296)

**Waarom:** De Rollen & Reststukken-pagina toont per (kw, kl) wel de voorraad en de openstaande inkoop, maar geen toekomstige rol-belasting uit open maatwerk-orders. Inkoper kon niet zien "moet ik (kw, kl) X weer bestellen?" zonder mentaal alle open snijplannen op te tellen. Snijplanning-pagina kijkt maar 4 weken vooruit; deze radar moet bewust álle open vraag tonen, ongeacht horizon.

**Wat:**
- **ADR-0026** ([docs/adr/0026-bruto-maatwerkvraag-naast-claim-cache.md](adr/0026-bruto-maatwerkvraag-naast-claim-cache.md)) — twee nieuwe domeinconcepten: [[Bruto-maatwerkvraag]] (pessimistische planning-projectie, geen Claim) en [[Vrij voor nieuw maatwerk]] (afgeleide KPI per uitwisselbare familie).
- **Formule per stuk:** `min(stuk.lengte_cm, stuk.breedte_cm) × kwaliteit.standaard_breedte_cm`, gesommeerd over snijplannen in `{Wacht, Gepland, Snijden}`, geaggregeerd op familie-sleutel `(collectie_id, genormaliseerde_kleur_code)` via [`uitwisselbare_paren()`](../supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql). Bewust **per-stuk pessimistisch** (geen packer-savings), **geen snij-marge** (ingebouwde overschatting van de formule is al pessimisme genoeg), **geen tijdshorizon-filter**.
- **Migratie 296** ([supabase/migrations/296_voorraadposities_bruto_maatwerkvraag.sql](../supabase/migrations/296_voorraadposities_bruto_maatwerkvraag.sql)): drop + recreate `voorraadposities(TEXT, TEXT, TEXT)` met body identiek aan mig 286 + 2 nieuwe CTE's (`snijplan_vraag_per_paar` + `familie_aggr` met `CROSS JOIN LATERAL uitwisselbare_paren()` per uniek (kw, kl)) + 2 nieuwe return-velden aan het einde (`bruto_maatwerkvraag_m2`, `vrij_voor_nieuw_maatwerk_m2`). Bestaande callers ongewijzigd — frontend leest velden bij naam, RPC-mapping in [`queries/voorraadposities.ts`](../frontend/src/modules/voorraadpositie/queries/voorraadposities.ts) heeft de velden optioneel zodat oudere RPC-versies geen runtime-fout geven.
- **Frontend:**
  - `Voorraadpositie`-type uitgebreid in [modules/voorraadpositie/types.ts](../frontend/src/modules/voorraadpositie/types.ts).
  - Nieuwe `VrijChip`-component in [rollen-groep-row.tsx](../frontend/src/components/rollen/rollen-groep-row.tsx) — neutrale slate-styling, verbergt zichzelf als `bruto_maatwerkvraag_m2 === 0`. Géén kleurcodering in V1 (ADR-0026: puur inzicht).
  - Sorteer-dropdown in [rollen-overview.tsx](../frontend/src/pages/rollen/rollen-overview.tsx) met 4 modi: Kwaliteit (default, ongewijzigd RPC-volgorde), Voorraad hoog→laag, Vrij laag→hoog, Bruto-vraag hoog→laag. `useMemo`-gebaseerde stabiele sortering met `(kwaliteit_code, kleur_code)` als tiebreaker.
- **V1-keuze: Claims niet in Vrij-formule** (review-fix). `producten.gereserveerd` is `SUM(order_reserveringen.aantal)` in **stuks** (mig 149), niet m². 1-op-1-aftrek zou voor gemengde families een fout cijfer geven (5 stuks vloerkleed 200×300 → −5 i.p.v. −30 m²). V1-formule = `voorraad − Bruto-vraag`. V2-backlog #6 in ADR-0026: conversie `aantal × stuk_m²` via `producten`-join.
- **Geen drempel, geen kleurcodering, geen auto-trigger in V1** — bewust "stap 1 = inzicht" (uitspraak Miguel tijdens grilling). V2-backlog: drempel + alarm-modus + tijdslijn-projectie tegen IO-leverweek + aparte Inkoop-radar-pagina met bulk-IO-creatie.
- **Domein-vocabulaire:** twee termen toegevoegd in [data-woordenboek.md](data-woordenboek.md) onder Producten & Voorraad: *Bruto-maatwerkvraag* en *Vrij voor nieuw maatwerk*.

## 2026-05-20 — Klant-facing maatwerk-sticker (mig 295)

**Waarom:** Karpi gebruikt al jaren een klant-facing sticker met debiteur-logo + product-data + EAN-13 op het opgerolde maatwerk-tapijt vóór verzending naar de eindafnemer (private-label-branding voor Stevens Meubel, CORE by Dersimo, Room108, lifestyle INTERIOR.NL by KARPI etc.). De pre-bestaande [`sticker-layout.tsx`](../frontend/src/components/snijplanning/sticker-layout.tsx) was operator-georiënteerd (QR-scancode, klantnaam, vorm, afwerking) en week visueel sterk af van wat de eindklant verwacht. Karpi wil de externe sticker exact in deze opmaak — operator-info verschuift naar werkbon/scanstation-scherm.

**Wat:**
- **Migratie 295** ([supabase/migrations/295_klant_facing_maatwerk_sticker.sql](../supabase/migrations/295_klant_facing_maatwerk_sticker.sql)):
  - Nieuwe kolom `kwaliteiten.poolmateriaal TEXT` — wordt handmatig per kwaliteit gevuld (open item bij Piet-Hein).
  - Nieuwe SQL-helper `sticker_ean_voor_kw_kl(kw, kl)` met resolutie-keten: eerst `*MAATWERK`-pseudo-product (bv. `LUXR68MAATWERK` → `8715954264751`), fallback rol-/BREED-artikel met EAN (bv. `LORA13400JUT` → `8715954171349`). Verklaart waarom Karpi's brondata-import 523 MAATWERK-EAN's al gemerged heeft naar BREED-rij.
  - Nieuwe view `snijplan_sticker_data` — alle sticker-velden in 1 row per snijplan, inclusief klanteigen kwaliteits-naam via [`resolve_klanteigen_naam`](../supabase/migrations/199_klanteigen_namen_kleur_code.sql) (Room108 ziet "CHIQUE" voor canonieke LUXURY). Bewust aparte view ipv `snijplanning_overzicht` aanpassen (44 kolommen, brede consumers — niet aanraken).
- **Frontend:**
  - Nieuwe `Ean13Barcode`-component ([frontend/src/components/ui/ean13-barcode.tsx](../frontend/src/components/ui/ean13-barcode.tsx)) — pure SVG-renderer met eigen L/G/R-encoding-tabellen volgens GS1, geen extra dependency (patroon volgt `Code128Barcode`).
  - `StickerLayout` ([frontend/src/components/snijplanning/sticker-layout.tsx](../frontend/src/components/snijplanning/sticker-layout.tsx)) volledig vervangen: 148×106 mm landschap, logo bovenaan (uit storage `logos/{debiteur_nr}.jpg`, fallback `logos/default.jpg`, daarna text), 4 velden links (Kwaliteit / Poolmateriaal / Kleur / Afmeting), EAN-13 rechts. Géén QR, scancode, klantnaam, vorm of afwerking — die info loopt voortaan via [`ProductieRolPage`](../frontend/src/pages/snijplanning/productie-rol.tsx) en het scanstation-scherm.
  - `fetchStickerData` + `fetchStickerDataBulk` query-functies en `useStickerData` + `useStickerDataBulk` hooks toegevoegd aan de Snijplanning-Module ([modules/snijplanning/queries/snijplanning.ts](../frontend/src/modules/snijplanning/queries/snijplanning.ts), [modules/snijplanning/hooks/use-snijplanning.ts](../frontend/src/modules/snijplanning/hooks/use-snijplanning.ts)).
  - Print-flow ongewijzigd: 2 stickers per snijplan (tapijt + orderdossier), geprint bij snijplan-aanmaak. `@page` aangepast van `100mm 60mm` naar `148mm 106mm` in [`sticker-print.tsx`](../frontend/src/pages/snijplanning/sticker-print.tsx) en [`stickers-bulk.tsx`](../frontend/src/pages/snijplanning/stickers-bulk.tsx).
- **Scope strikt:** alleen maatwerk-sticker; [`reststuk-sticker-layout.tsx`](../frontend/src/components/snijplanning/reststuk-sticker-layout.tsx) en [`rol-sticker-layout.tsx`](../frontend/src/modules/inkoop/components/rol-sticker-layout.tsx) blijven ongewijzigd (interne stickers, niet voor eindklant).
- **Open items** (uit grilling-sessie):
  1. Het 4-cijfer-nummer rechts naast Kleur op de fysieke foto-stickers (kleur 13 → 2621, kleur 68 → 2620) is in producten/EAN/kwaliteit/prijslijsten/leveranciers niet vindbaar. Vermoedelijk legacy fabrikant-/batch-code uit oude Vorratliste. Voor V1 niet gerenderd — wordt nagevraagd bij Karpi.
  2. `kwaliteiten.poolmateriaal` moet voor alle relevante kwaliteiten gevuld worden (NULL = veld niet getoond).
  3. Karpi-default-logo op `logos/default.jpg` moet nog geupload worden.
- **Domein-vocabulaire:** drie termen toegevoegd in [data-woordenboek.md](data-woordenboek.md) onder Maatwerk: *Klant-facing maatwerk-sticker*, *Sticker-EAN-bron*, *Poolmateriaal (kwaliteit)*.
- **Geen ADR:** scope per grilling-sessie te beperkt (UI-vervanging + data-veld), data-woordenboek bevat de domein-keuze.

## 2026-05-20 — Shape-bias in reststuk-scoring (ADR-0025)

**Waarom:** Op rol VERR130 C kreeg de operator een 75×905-strip + 75×450 + 95×230 als reststukken — lange smalle latjes die in de praktijk alleen voor staaltjes inzetbaar zijn. Vanuit dezelfde 3 placements (250×450 + 325×225 + 235×235) was een 150×450 chunky stuk mogelijk geweest dat als woon-tapijt verkoopbaar is. Probleem: de packer-scoring én greedy-disjoint-rapportage telden vrije rechthoeken op pure m², dus 150×450 (67 500 cm²) en 75×905 (67 875 cm²) waren voor het algoritme indifferent.

**Wat:**
- **Shape-biased scoring** `area × √(short/long)` op 3 plekken in lockstep:
  [_shared/guillotine-packing.ts::reststukScoreCm2](../supabase/functions/_shared/guillotine-packing.ts) (packer-keuze),
  [_shared/compute-reststukken.ts::greedyDisjointReststukken](../supabase/functions/_shared/compute-reststukken.ts) (backend fysieke reststuk-aanmaak),
  [frontend/.../snijplanning/lib/compute-reststukken.ts](../frontend/src/modules/snijplanning/lib/compute-reststukken.ts) (modal).
- 150×450 scoort nu 38 950, 75×905 scoort 19 550 → chunky vorm wint duidelijk; 200×200 vierkant scoort 40 000 → wint van 150×450.
- Kwalificatie-drempel (`RESTSTUK_MIN_SHORT=50`, `RESTSTUK_MIN_LONG=100`) ongewijzigd: smalle strips blijven reststuk (voor latent staaltjes-gebruik), trekken alleen geen placement-voorkeur meer.
- Tests: nieuwe `ADR-0025: VERR130 C-scenario` in [guillotine-packing.test.ts](../supabase/functions/_shared/guillotine-packing.test.ts); nieuwe `ADR-0025: 150×450 wint van 75×905` in [compute-reststukken.test.ts](../supabase/functions/_shared/compute-reststukken.test.ts); nieuwe parity-suite voor frontend-spiegel in [frontend/.../__tests__/compute-reststukken.test.ts](../frontend/src/modules/snijplanning/lib/__tests__/compute-reststukken.test.ts). IC2901TA13B-assertion bijgewerkt — pre-bias claimde de end-strip als 1 reststuk (400×50), post-bias als 2 chunkier deelclaims (157×80 + 243×50) — functioneel equivalent, anders gegroepeerd.
- Domein-vocabulaire: dubbele *Reststuk*-entry in [data-woordenboek.md](data-woordenboek.md) geconsolideerd; *Reststuk-scoring* en *Staaltjes-restant* toegevoegd.
- Geen DB-migratie nodig — `bereken_rol_type()` trigger en `maak_reststuk()`-RPC blijven ongewijzigd; deze ADR raakt alleen algoritmische scoring, geen data-classificatie.
- Pre-existing test-failure `REGRESSIE K1756006D` (al vóór deze wijziging rood) niet geadresseerd; valt buiten scope.
- **ADR:** [docs/adr/0025-shape-bias-in-reststuk-scoring.md](adr/0025-shape-bias-in-reststuk-scoring.md).

## 2026-05-15 — Klant-PO parsing: order uitvullen vanuit PDF

**Waarom:** Klanten sturen inkooporders als PDF. Medewerkers typten die handmatig over — foutgevoelig en tijdrovend. Nu kan de medewerker een PDF uploaden via `DocumentenBuffer`, waarna het systeem automatisch debiteur, artikelen en aantallen herkent en het order-formulier voorinvult.

**Wat:**
- **Edge function `parse-klant-po`** (`supabase/functions/parse-klant-po/`) — twee lagen: (1) Claude Messages-API extractie van vormvrije ruwe tekst uit de PDF (`_shared/po-extract.ts`, pure module zonder side-effects); (2) deterministische match-RPC `match_klant_po` (mig 294) koppelt het resultaat aan de database. Vereist secret `ANTHROPIC_API_KEY` op de edge-functie-omgeving.
- **[mig 294](../supabase/migrations/294_match_klant_po.sql) — RPC `match_klant_po(p_extractie jsonb) → jsonb`:** Debiteur via btw → e-maildomein → exacte naam (telkens precies 1 hit = `zeker`, anders geen debiteur; alleen actieve debiteuren). Per regel: kwaliteit via reverse-lookup op `klanteigen_namen.benaming` (debiteur-/inkoopgroep-scoped) én exacte `kwaliteiten.omschrijving`; kleur via numeriek suffix; artikel via `klant_artikelnummers` of `producten`-lookup. Debiteur én elke regel krijgen een eigen `zeker`-label; alleen `zeker`-regels en een `zeker`-debiteur worden voorgevuld (adres + klant-referentie altijd als concept).
- **UI:** "📄 Order uitvullen"-knop per PDF in `DocumentenBuffer` + samenvattingsbanner met confidence-indicatie. `OrderCreatePage` hermount `OrderForm` via een `key` met de voorgevulde `initialData`. Geen auto-opslag.
- **Bekende V1-beperking:** het opnieuw selecteren van de debiteur in het klantveld ná parsen overschrijft het uit de PO voorgevulde afleverdatum/`afl_*`/`fact_*` met de debiteur-stamgegevens (bestaand `handleClientChange`-gedrag). Operator zet het PO-afleveradres dan zo nodig handmatig terug. V2-backlog.
- **Spec:** [`docs/superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md`](superpowers/specs/2026-05-15-klant-po-parsing-order-uitvullen-design.md).

## 2026-05-15 — Handmatige rol-/reststuk-CRUD
- Rollen & Reststukken-pagina: rollen/reststukken toevoegen, bewerken,
  verwijderen via RPC-laag (mig 291-293) + audittabel `rol_mutaties` (mig 290).
- Verwijder-guard: alleen `beschikbaar`/los reststuk, niet in snijplan.
- **Herziene aanname:** `producten.voorraad` wordt bewust NIET gekoppeld — de
  pagina is live-correct via `SUM(rollen)`; voor rol-artikelen is
  `producten.voorraad` legacy/ongelezen (zie ADR-0024).

## 2026-05-15 — Order annuleren ruimt nu snijplannen + rollen op

**Waarom:** P. Dobbe annuleerde een order maar de snijplannen bleven op de snijlijst staan en de gereserveerde rollen kwamen niet vrij. Werkvloer-verwachting: een geannuleerde order verdwijnt van de snijlijst en alle stukken/rollen komen vrij.

**Root cause:** `markeer_geannuleerd` ([mig 218](../supabase/migrations/218_order_lifecycle_module.sql)) schrijft een `geannuleerd`-event; daarop reageerde alleen `trg_order_events_reservering_release` ([mig 255](../supabase/migrations/255_reservering_order_events_trigger.sql)) — die releaset `order_reserveringen` (voorraad+IO), maar **niemand cancelt de snijplannen**. Hun status bleef `'Gepland'`/`'Snijden'`, rol bleef `in_snijplan`. Bovendien miste `snijplanning_overzicht` ([mig 233](../supabase/migrations/233_snijplanning_overzicht_placed_kolommen.sql)) een order-status-filter, anders dan de zustersview `orderregel_pickbaarheid` (mig 288, regel 101).

**Wat:** [mig 290](../supabase/migrations/290_order_annulering_release_snijplannen.sql) + [ADR-0023](adr/0023-order-annulering-cascadeert-naar-snijplanning.md) — drie delen: (1) nieuwe Snijplanning-Module event-listener `trg_order_events_snijplan_release` op `order_events` `WHEN event_type='geannuleerd'`, symmetrisch met mig 255 → alle snijplannen van de order naar `Geannuleerd` (ongeacht voortgang, werkvloer-keuze) + geraakte rollen die hun laatste actieve snijplan verliezen → `beschikbaar`/`reststuk` (patroon uit `release_gepland_stukken`, mig 133, inclusief `NOT EXISTS`-guard voor gedeelde rollen); (2) `snijplanning_overzicht` krijgt `WHERE o.status <> 'Geannuleerd'` (defense-in-depth; bewust NIET ook `'Verzonden'` — die view voedt ook de fysieke rol-uitvoer + packer); (3) backfill van bestaande Geannuleerd-orders met levende snijplannen (repareert P. Dobbe's order). Vrijgekomen rollen worden via de bestaande rol-status-trigger (mig 111) automatisch heraangeboden aan auto-plan.

## 2026-05-15 — Confectie-buffer default → 0 minuten

**Waarom:** De 15-min confectie-buffer (mig 103) liet een vers-gesneden stuk 15 min onzichtbaar uit de Confectielijst — verwarrend op de werkvloer. Bedrijfskeuze: gesneden stukken direct beschikbaar voor confectie.

**Wat:** [mig 289](../supabase/migrations/289_confectie_buffer_default_nul.sql) — live `app_config.productie_planning.confectie_buffer_minuten` → `0` én fallback in `confectie_buffer_minuten()` van 15 → 0. View `confectie_planning_forward` ongemoeid (leest de functie dynamisch); buffer-WHERE wordt met 0 inert → Gesneden stukken verschijnen direct. Omkeerbaar via config-waarde.

## 2026-05-15 — Pick & Ship: maatwerk-orders niet meer "tussen wal en schip"

**Waarom:** Maatwerk-orders met meerdere stuks waarvan er nog één op `'Snijden'` stond verdwenen geruisloos uit Pick & Ship — zónder enige `wacht_op`-reden, dus ook nergens zichtbaar als "Wacht op snijden". Voorbeeld: ORD-2026-2067 (regel 1, 5 stuks: 4× `Ingepakt`, 1× `Snijden`) → `is_pickbaar=false` (terecht) maar `wacht_op=NULL` (bug).

**Root cause:** De `slechtste_rang`-CASE in [mig 170](../supabase/migrations/170_orderregel_pickbaarheid_view.sql) miste de status `'Snijden'` (geldige `snijplan_status`, toegevoegd in legacy mig 051 `BEFORE 'Gesneden'`). Een `'Snijden'`-snijplan viel in `ELSE NULL`; `MIN()` negeert NULL's → `slechtste_rang` werd ten onrechte de béste i.p.v. de slechtste status. De invariant ("wacht_op afgeleid van slechtst-presterende snijplan") was kapot voor élke maatwerkregel met een `'Snijden'`-stuk náást gevorderde stukken.

**Wat:** [mig 288](../supabase/migrations/288_orderregel_pickbaarheid_snijden_rang.sql) — `WHEN 'Snijden' THEN 2` toegevoegd aan de rang-CASE (`'snijden'`-bucket, gelijk aan `'Gepland'`). `is_pickbaar` ongewijzigd (leunt op `pickbaar_stuks/totaal_stuks`); alleen `wacht_op` flipt van `NULL` → `'snijden'` voor de getroffen regels, zodat de order zichtbaar "Wacht op snijden" is i.p.v. spoorloos. Verder identiek aan mig 170. Stale enum-doc in [database-schema.md](database-schema.md) (`snijplan_status` miste `Snijden`) meteen meegecorrigeerd.

## 2026-05-15 — in_magazijn_sinds: record-aanmaakdatum i.p.v. sentinel

**Waarom:** Mig 280 gaf historische rollen zonder IO-koppeling de sentinel `2000-01-01`; op de rollen-pagina was dat onbruikbaar. Beter signaal = de aanmaakdatum van het rollen-record in Supabase.

**Wat:** [mig 287](../supabase/migrations/287_in_magazijn_sinds_created_at_default.sql) — backfill: sentinel-rijen → `created_at::date`, daarna reststuk-keten opnieuw geërfd (recursieve CTE). Nieuwe rollen zonder expliciete waarde krijgen via BEFORE INSERT-trigger `trg_rollen_default_in_magazijn_sinds` `COALESCE(created_at, reststuk_datum, CURRENT_DATE)::date`. Defensief: valt terug op `reststuk_datum` als `rollen.created_at` niet bestaat. IO-ontvangst (mig 281) en reststuk-erfgang (mig 282) blijven leidend en passeren de trigger ongemoeid.

## 2026-05-15 — FIFO-snijplanner geparkeerd in modus 'simpel'

**Waarom:** Interne rol-data is nog niet op orde; de volledige leeftijd-kost-afweging zou daardoor nog niet betrouwbaar werken. We zetten de geavanceerde laag bewust "achter de schermen" maar behouden alle code, zodat dit later live kan.

**Wat:**
- [mig 285](../supabase/migrations/285_snijplanning_fifo_modus_simpel.sql) — `app_config.snijplanning.modus` (default `'simpel'`). `simpel` = strikt oudste-rol-eerst, geen kost-afweging/badge/carve-out (`fifoMetrics` leeg). `geavanceerd` = de volledige ADR-0021-functionaliteit.
- [mig 286](../supabase/migrations/286_voorraadposities_in_magazijn_sinds.sql) — `voorraadposities`-RPC geeft `in_magazijn_sinds` mee en sorteert de rol-lijst per (kw,kl) **oudste-eerst**.
- Packer ([`guillotine-packing.ts`](../supabase/functions/_shared/guillotine-packing.ts)): `modus !== 'geavanceerd'` → één strikte FIFO-pass, geen metrics. [`buildFifoOptions`](../supabase/functions/_shared/db-helpers.ts) leest `modus` (default `simpel`).
- Rollen-overzicht ([`rollen-groep-row.tsx`](../frontend/src/components/rollen/rollen-groep-row.tsx)): kolom **"Binnen sinds"** + groene **"1e binnen"**-markering op de oudst-binnengekomen rol. `RolRow.in_magazijn_sinds` toegevoegd.
- Instellingen → Productie Instellingen: **modus-toggle** Eenvoudig/Geavanceerd; de geavanceerde criteria zijn zichtbaar maar uitgegrijsd in `simpel`.
- ADR-0021 amendement + CLAUDE.md-bedrijfsregel bijgewerkt naar de geparkeerde status.

**Beslissing:** gebruiker, 2026-05-15 — eerst data op orde, dan `modus='geavanceerd'`.

## 2026-05-15 — FIFO-magazijnleeftijd in de snijplanner (ADR-0021)

**Waarom:** Kleurverschil tussen tapijtrollen van dezelfde kwaliteit+kleur ontstaat puur door fysieke veroudering in het magazijn. De packer optimaliseerde alleen op snijverlies/rol-zuinigheid, waardoor oude voorraad onbeperkt kon blijven liggen en latere leveringen/herhalbestellingen kleurverschil gaven. Nu weegt de packer magazijnleeftijd mee — oudere rollen bij voorkeur eerst wegsnijden — zonder andere orders te benadelen, en zonder de flow te verzwaren.

**Wat:**
- [mig 280](../supabase/migrations/280_rollen_in_magazijn_sinds.sql) — `rollen.in_magazijn_sinds DATE` + backfill (IO-rol → ontvangstdatum; reststuk-keten → erft via recursieve CTE van de wortel; historische import → sentinel `2000-01-01`).
- [mig 281](../supabase/migrations/281_boek_ontvangst_in_magazijn_sinds.sql) — `boek_inkooporder_ontvangst_rollen` vult `in_magazijn_sinds = CURRENT_DATE`. `reststuk_datum` blijft `NOW()` (traceability ongewijzigd).
- [mig 282](../supabase/migrations/282_voltooi_snijplan_rol_erf_magazijnleeftijd.sql) — nieuwe reststukken erven `in_magazijn_sinds` van de moederrol (klok reset **niet** bij snijden); `reststuk_datum = CURRENT_DATE`-afhankelijkheid voor kostentoerekening ongemoeid.
- [mig 283](../supabase/migrations/283_app_config_snijplanning_fifo.sql) — `app_config.snijplanning`: `drempel_dagen=90`, `harde_bovengrens_dagen=180`, `alpha=0.05`, badge-drempels (geel +5 m²/+25%, rood +10 m²/+50%) — online tunebaar.
- [mig 284](../supabase/migrations/284_snijvoorstellen_fifo_metrics.sql) — `snijvoorstellen.fifo_badge` + extra-afval/oudste-rol/rolwissel-metrics + `fifo_rationale` JSONB.
- Packer ([`_shared/guillotine-packing.ts`](../supabase/functions/_shared/guillotine-packing.ts)): kostfunctie `afval − α·max(0, leeftijd−drempel)` met absolute voorrang ≥180 dgn, derde rol-sorteerstrategie (oudste/over-bovengrens eerst), harde constraints **C1** (geen verdringing van gereserveerde rollen) en **C2** (geen deadline-schade → terugval op efficiency), plus short-circuit voor verse voorraad. Interfaces in [`_shared/ffdh-packing.ts`](../supabase/functions/_shared/ffdh-packing.ts); helpers `buildFifoOptions`/`fetchGereserveerdeRolIds` in [`_shared/db-helpers.ts`](../supabase/functions/_shared/db-helpers.ts).
- Edge: [`optimaliseer-snijplan`](../supabase/functions/optimaliseer-snijplan/index.ts) + [`auto-plan-groep`](../supabase/functions/auto-plan-groep/index.ts) geven FIFO-opties door en slaan de metrics op. **Auto-approve-carve-out:** een rode badge wordt niet automatisch goedgekeurd — voorstel blijft `concept`.
- Frontend: subtiele [`FifoBadge`](../frontend/src/components/snijplanning/fifo-badge.tsx) (grijs = onzichtbaar, geel/rood = uitklapbare afweging) in [`snijvoorstel-modal.tsx`](../frontend/src/components/snijplanning/snijvoorstel-modal.tsx) en [`snijvoorstel-review.tsx`](../frontend/src/pages/snijplanning/snijvoorstel-review.tsx); types + `mapFifo` in [`productie.ts`](../frontend/src/lib/types/productie.ts) / [`snijvoorstel.ts`](../frontend/src/modules/snijplanning/queries/snijvoorstel.ts).

**Niet gewijzigd / V2-backlog:**
- Zonder `PackOptions.fifo` is het packer-gedrag exact als voorheen (bestaande ffdh/guillotine-tests ongewijzigd).
- C2 is conservatief (val-terug-op-efficiency bij conflict); per-rolwissel-rollback staat op de V2-backlog.

**Beslissing:** gebruiker, 2026-05-15 — grilling-with-docs sessie. Zie [ADR-0021](adr/0021-magazijnleeftijd-fifo-als-kostdimensie-in-snijplanner.md).

## 2026-05-15 — ADR-0020-amendement: twee bewust gescheiden levertijd-paden

**Waarom:** Bij afronding bleek de plan-aanname "edge `check-levertijd` wordt thin wrapper rond de RPC's" een verkeerde één-vormigheid. `LevertijdSuggestie` draait op een **pre-persist maatwerk-config** (kwaliteit/kleur/maten, géén orderregel-id, rijke scenario-UX); de Module-RPC's werken op **gepersisteerde regel-id's** met smalle output. 1-op-1 migratie is technisch onmogelijk én zou een UX-regressie zijn.

**Wat (documentatie + comment-correcties, geen functionele wijziging):**
- [ADR-0020](adr/0020-levertijd-als-deep-module.md): Amendement-sectie (2026-05-15) — de edge is een **permanent apart pad**, geen afgedankte back-compat. Ingreep 2 / stap 7 "thin wrapper" + backlog "edge verwijderen" vervallen expliciet.
- [`use-levertijd-check.ts`](../frontend/src/hooks/use-levertijd-check.ts): misleidende "verdwijnt bij stap 6/7"-comment en `@deprecated` op `useLevertijdCheck` vervangen door uitleg dat dit een bewust permanent pad is. De `useFitCheck`-re-export blijft wél migratie-alias (ESLint-regel ongewijzigd).
- [`data-woordenboek.md`](data-woordenboek.md): Levertijd-Module-entry — "thin RPC-wrapper" vervangen door de twee-paden-beschrijving.
- Plan-bestand stap 7: thin-wrapper-acceptatiecriterium doorgehaald met amendement-verwijzing.

**Beslissing:** gebruiker, 2026-05-15 — twee paden bewust scheiden. Convergentie (config-based `levertijd_fit_check_config`) blijft mogelijk zonder breaking change maar is niet gepland; alleen bij concrete trigger (edge-runtime uitfaseren).

## 2026-05-13 — Levertijd-Module geïmplementeerd (stap 2-10, ADR-0020)

**Waarom:** De architectuur-beslissing uit [ADR-0020](adr/0020-levertijd-als-deep-module.md) (Levertijd als deep capaciteit-seam-owner-Module) is nu volledig uitgevoerd — het 10-stappen-plan is afgerond. Verspreide levertijd-logica heeft één eigenaar; het order-niveau-label `levertijd_status` is end-to-end live.

**Wat:**
- [mig 277](../supabase/migrations/277_levertijd_rpc_skeleton.sql) — publieke RPC's `levertijd_fit_check(p_regel_ids[], p_gewenste_week)` + `levertijd_snelste_haalbaar(p_regel_ids[])`. Voorraad-pad realistisch (consumeert Reservering's `order_regel_levertijd`-view + uitwisselbaar-dekking); maatwerk eerst als stub.
- [mig 278](../supabase/migrations/278_levertijd_maatwerk_capaciteit.sql) — maatwerk capaciteit-match op **week-niveau** (optie B): match tegen open snijplannen + `app_config.productie_planning`-config (capaciteit per week, wisseltijd, logistieke buffer). Géén `productie_groep`-segmentering in V1.
- [mig 279](../supabase/migrations/279_werkagenda_sql_functions.sql) — werkagenda als SQL-ground-truth: `werkdag_min_n` / `werkdag_plus_n` / `werkagenda_kalender`.
- Frontend-Module [`modules/levertijd/`](../frontend/src/modules/levertijd/): barrel `index.ts`, `cache.ts`, `types.ts`, `queries/`, hooks (`useFitCheck` debounced, `useSnelsteHaalbaar`, `useLevertijdStatus`, `useNeemSnelsteOver`) en components ([`LevertijdStatusBadge`](../frontend/src/modules/levertijd/components/levertijd-status-badge.tsx), [`LevertijdFitIndicator`](../frontend/src/modules/levertijd/components/levertijd-fit-indicator.tsx), [`SnelsteHaalbaarKnop`](../frontend/src/modules/levertijd/components/snelste-haalbaar-knop.tsx)).
- Integratie: live fit-check + "Snelste haalbare overnemen"-knop in [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx); `<LevertijdStatusBadge>`-slot in de order-detail-header.
- Werkagenda-spiegel-borging: [`bereken-agenda.ts`](../frontend/src/lib/utils/bereken-agenda.ts) en [`_shared/werkagenda.ts`](../supabase/functions/_shared/werkagenda.ts) geannoteerd als *synchronous-only mirror* van de SQL-ground-truth (alleen voor rekenwerk dat geen DB-roundtrip mag triggeren).
- architectuur.md: Levertijd toegevoegd als dertiende domein-module in de Module-grafiek.

**Niet gewijzigd / V2-backlog:**
- Confectie-capaciteit-check (interface bereid voor uitbreiding, nog niet aangesloten).
- `productie_groep`-segmentering van de maatwerk-capaciteit (V1 = week-niveau totaal).
- FFDH-passt-check binnen de capaciteit-match.
- `lever_type`-dag-buffer blijft canoniek in edge `check-levertijd` — Levertijd-Module raakt dat pad niet.
- Bevroren leverbelofte-tabel + EDI/factuur/pakbon-consumers van het `levertijd_status`-label.
- Orders-overview-badge-integratie uitgesteld i.v.m. parallel werk aan de orders-overzichtspagina (klant-filter); detail-header + order-form zijn wél live.

## 2026-05-13 — Orders-overview: klant-filter (multi-select op naam + debiteur-nr)

**Waarom:** Op de orders-overzichtspagina kon je alleen via de vrije-tekst-zoekbalk filteren op klant — geen overzicht van welke klanten orders hebben en geen multi-select. De facturen-pagina had dit patroon al via `MultiSelectDropdown`; orders nu uniform mee.

**Wat:**
- [`orders.ts`](../frontend/src/lib/supabase/queries/orders.ts): `fetchOrders` accepteert nu `debiteurNrs: number[]` (via `.in('debiteur_nr', …)`); bestaande `debiteurNr` (single) blijft als fallback. Nieuwe query `fetchOrderKlantOpties` haalt distinct `(debiteur_nr, klant_naam)` op uit `orders_list` (JS-dedupe, range 0-9999 — vervang door DB-view als dat knelt).
- [`use-orders.ts`](../frontend/src/hooks/use-orders.ts): nieuwe hook `useOrderKlantOpties` (60s staleTime).
- [`orders-overview.tsx`](../frontend/src/pages/orders/orders-overview.tsx): `MultiSelectDropdown` naast de zoekbalk. Optie-label is `"NAAM (#nr)"` zodat de ingebouwde zoekbalk én op klantnaam én op debiteur-nummer matcht. Selectie reset paginering naar 0.

**Niet gewijzigd:** PostgREST `or()` met klant-naam in de zoekbalk blijft bestaan — dat is vrije-tekst-zoek over `order_nr / klant_referentie / klant_naam`. De multi-select is een orthogonale, expliciete klant-filter.

## 2026-05-13 — Mig 275: 'Nieuw' deprecate als runtime-status (sluit ADR-0016 af)

**Waarom:** Op orders 2063-2067 verscheen vandaag de badge `Nieuw`, terwijl die status sinds ADR-0016 / mig 257-258 gedeprecateerd is. Geen filter-tab toonde hem, geen workflow gebruikte hem — puur als gevolg van drie samenwerkende regressies:
- Kolom-DEFAULT van `orders.status` stond nog op `'Nieuw'`.
- `create_order_with_lines` (mig 245 r. 55) en `edi_create_order` (mig 166 r. 130) schreven expliciet `'Nieuw'`.
- `herbereken_wacht_status` (mig 273) was back-geport naar de mig-218-vorm waarin `'Nieuw'` weer de default-eindstaat is — de ADR-0016-uitbreidingen (Wacht op maatwerk, Klaar voor picken-target) gingen verloren tijdens het admin-pseudo-filterpatroon uit mig 269/273.

**Wat:**
- [275_nieuw_status_deprecate_klaar_voor_picken.sql](../supabase/migrations/275_nieuw_status_deprecate_klaar_voor_picken.sql) — vijf wijzigingen in één migratie:
  1. `ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'Klaar voor picken'`.
  2. `create_order_with_lines` schrijft `'Klaar voor picken'`.
  3. `edi_create_order` patcht zijn literal via DO-block (`'Nieuw'` → `'Klaar voor picken'`).
  4. `herbereken_wacht_status` hersteld met mig-258-takken (Wacht op maatwerk + Klaar voor picken-target), `is_admin_pseudo()`-filter behouden, eindstatus-bescherming uitgebreid met `In pickronde` / `Deels verzonden`.
  5. Backfill bestaande `'Nieuw'`-orders volgens ADR-0016 §"Backfill" (uitgebreid met IO-claim-tak en admin-pseudo-filter t.o.v. mig 258 §7).
- UI-cleanup ([status-tabs.tsx](../frontend/src/components/orders/status-tabs.tsx), [orders.ts](../frontend/src/lib/supabase/queries/orders.ts)) — de cosmetische fallback die `'Nieuw'` onder de `'Klaar voor picken'`-tab telde, en de OR-query op dezelfde tab, zijn verwijderd. `ORDER_STATUS_COLORS` behoudt de `'Nieuw'`-mapping voor audit-history.
- [`vertegenwoordigers.ts`](../frontend/src/lib/supabase/queries/vertegenwoordigers.ts) `ACTIVE_ORDER_STATUSES` uitgebreid met de canonieke ADR-0016-statussen — voorkomt dat order-tellingen per vertegenwoordiger orders missen die nu op `'Klaar voor picken'` / `'Wacht op maatwerk'` / etc. staan.

**Niet gewijzigd:**
- `'Nieuw'` blijft in het `order_status` ENUM voor audit-history (oude `order_events`-rijen referencen het). De ENUM-waarde verwijderen kan pas na meerdere maanden audit-rollover.
- `create_webshop_order` (mig 093) zet geen expliciete status — die erft voortaan automatisch de nieuwe kolom-DEFAULT.

## 2026-05-13 — ADR-0020: Levertijd als deep Module (capaciteit-seam owner + status-label)

**Waarom:** Levertijd-logica zit verspreid over ~1400 regels in drie runtimes (frontend TS, Deno-edge, SQL-view) zonder unieke eigenaar. Vijf interface-ingangen, twee runtime-spiegels van werkagenda-rekenkunde, en geen seam-erkenning vergelijkbaar met snij-marge (ADR-0013). Aanleiding: Karpi wil aan de voorkant van het order-intake-proces aan de klant kunnen communiceren dat de levertijd afwijkt van standaard (eerder als haast, later als planning vol), getoetst tegen actuele snij-planning.

**Wat:**
- [ADR-0020](adr/0020-levertijd-als-deep-module.md) — beslissing: Levertijd-Module wordt **capaciteit-seam owner**, niet eigenaar van de leverbelofte zelf. SQL-Module met smal publiek interface (analoog aan Gewicht-resolver, mig 184-186): twee RPC's `levertijd_fit_check` en `levertijd_snelste_haalbaar`.
- Scope-onderscheid Reservering vs Levertijd: Reservering blijft eigenaar van `order_regel_levertijd`-view + `sync_order_afleverdatum_met_claims` (IO-claim-driven leverweek + afleverdatum-schuif); Levertijd bezit de capaciteit-/planning-driven haalbaarheids-vraag.
- Order-niveau label: nieuw `orders.levertijd_status` enum (`standaard | eerder_dan_standaard | later_dan_standaard`) + bevroren snapshot `orders.standaard_afleverdatum_berekend`. Label geschreven bij commit én via trigger op `orders.afleverdatum`-change zodat IO-vertraging automatisch het label flipt.
- UX: `<LevertijdStatusBadge>`-slot naast ordernummer (order-list + order-detail header), live fit-check in order-form, "Snelste haalbare overnemen"-knop op operator-aanvraag.
- Confectie-capaciteit-check expliciet V2-backlog; bevroren leverbelofte-tabel + EDI-update-flow ook V2.
- data-woordenboek bijgewerkt met 4 nieuwe terms (Levertijd-Module, Levertijd-status, Levertijd-fit-check, Levertijd-snelste-haalbaar) + Reservering-entry verhelderd waar "later Levertijd-Module" achterhaald was.

**Wat is in deze commit:** ADR-0020 + [10-stappen-plan](superpowers/plans/2026-05-13-levertijd-als-deep-module.md) + stap 1 als [mig 276](../supabase/migrations/276_levertijd_status_kolom_en_trigger.sql) — twee nieuwe kolommen op `orders` (`levertijd_status` enum + `standaard_afleverdatum_berekend` DATE), BEFORE-trigger `trg_levertijd_status_recalc()` die het label automatisch deriveert uit afleverdatum vs snapshot, en forward-looking backfill voor bestaande orders met afleverdatum. ASSERT-blok verifieert trigger-aanmaak + backfill-volledigheid. Vervolgstappen 2-10 (RPC-skeleton, Module-skelet, hook-migratie, badge, order-form-integratie, Deno → SQL capaciteit-match, werkagenda-spiegel-cleanup) in opvolgende commits per stap.

## 2026-05-13 — Factuur-PDF: lange omschrijving wrapt over 2 regels (geen ellips-afkapping meer)

**Waarom:** Op FACT-2026-0019 vielen de admin-pseudo-omschrijvingen weg met "Drempelkorting verzen…" en "Bundelkorting verzen…" — de Omschrijving-kolom is ~26 chars breed (Courier 9pt), de SQL-format-strings uit mig 264/268 leveren 40+ chars. Truncate met ellips maakte de regel betekenisloos op de factuur die de klant ziet.

**Wat:**
- [`factuur-pdf.ts`](supabase/functions/_shared/factuur-pdf.ts) — nieuwe helper `splitOmschrijvingOverRegels(text, firstMaxWidth, restMaxWidth, ...)`. Hoofdregel krijgt zoveel woorden als passen naast de Prijs-kolom; rest komt als extra wrap-regel(s) onder de hoofdregel op de bredere `EXTRA_MAX_W` (volle ruimte tot Bedrag-kolom). Wraps op woordgrens; valt terug op truncate-met-ellips alleen als zelfs het eerste woord niet past.
- Render-lus past `rowCount` aan zodat `ensureRoom` ook de wrap-regels meetelt — geen overflow op pagina-grens.
- `omschrijving_2`-regels (BANGKOK KLEUR / Band: / Uw model: …) blijven verschijnen ná de wrap-regels van de hoofd-omschrijving.
- Test toegevoegd voor `DREMPELKORTING` + `BUNDELKORTING` met realistische 40+ char strings.

**Niet gewijzigd:** kolombreedtes blijven gelijk (Prijs-positie ongewijzigd) — bestaande compacte rendering voor korte omschrijvingen ziet er identiek uit. Generieke fix: elke toekomstige korting / toeslag / admin-pseudo met lange omschrijving wrapt automatisch.

## 2026-05-13 — Mig 274 + ADR-0019: snijplan-rij = 1 fysiek maatwerk-stuk

**Waarom:** Op ORD-2026-2067 (5× maatwerk BILA 14 200×230) toonde de snij-modal slechts 1 stuk te snijden i.p.v. 5. Root cause: `auto_maak_snijplan()` (mig 110) maakte sinds dag 1 exact één snijplan-rij aan per orderregel, ongeacht `orderaantal`. Bug bleef onzichtbaar omdat maatwerk in de praktijk vrijwel altijd `orderaantal=1` had.

**Wat:**
- [ADR-0019](adr/0019-snijplan-per-fysiek-stuk-niet-per-orderregel.md) — beslissing: één snijplan-rij = één fysiek stuk = één sticker. Maatwerk-regel met `orderaantal=N` seed N snijplan-rijen.
- `auto_maak_snijplan()` — FOR-loop over orderaantal, `volgend_nummer('SNIJ')` per iteratie zodat snijplan_nr uniek blijft.
- `auto_sync_snijplan_maten()` — sync álle snijplannen van de regel (geen `LIMIT 1` meer). Snijplannen met rol of voorbij Snijden blijven onaangeroerd, met WARNING-log voor handmatige actie.
- Backfill: maatwerk-regels in non-eindstatus orders met aantal_snijplannen < orderaantal worden aangevuld in `Wacht`-status. ORD-2026-2067 krijgt 4 extra snijplannen die door de eerstvolgende optimalisatie-run op rollen geplaatst worden.

**Bekende beperking:** UPDATE-trigger luistert niet op orderaantal-mutaties; latere wijziging van orderaantal vereist handmatige release-en-hersnijden. Acceptabel voor V1 — zeldzame mutatie.

## 2026-05-13 — Mig 272 + Mig 273 + ADR-0018: Admin-pseudo-orderregel als data-driven concept

**Waarom:** De claim-keten-recursiebug van eerder vandaag (mig 263 → 266 → 269 als driedubbele fix) bewees dat 15+ hardcoded `('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')`-string-lijsten in SQL én FE een onhoudbare regressie-bron zijn. Nieuwe admin-pseudo toevoegen vereiste een grep-en-pray over 20 plekken. CLAUDE.md had inmiddels een hele bedrijfsregel die zei "drie plekken moeten ze identiek filteren".

**Wat:**
- [ADR-0018](adr/0018-admin-pseudo-orderregel-als-data-driven-concept.md) — beslissing: data-gedreven via `producten.is_pseudo`, geen TS-spiegel met hardcoded lijst, boolean reist mee in queries.
- Mig 272: `producten.is_pseudo BOOLEAN` + `is_admin_pseudo(text) STABLE PARALLEL SAFE`-helper + backfill voor de 3 bestaande pseudo's + partial index. ASSERT-blok verifieert backfill (=3 rijen) + helper-gedrag.
- Mig 273: callsite-rewrites — `herwaardeer_claims_voor_order` (was 263), `trg_orderregel_herallocateer` (was 266), `herbereken_wacht_status` + view `order_regel_levertijd` (was 269+270). Pure refactor; ASSERT-blok bewijst gedragsidentiteit.
- FE: `lib/orders/admin-pseudo.ts` + `isAdminPseudo(regel)`-helper (accepteert form-data shape én query-resultaten met `producten ( is_pseudo )`-join). 8 unit-tests groen.
- FE-callsites omgezet: `dekking-preview.ts`, `order-afleverdatum.ts`, `article-selector.tsx` (server-side `.eq('is_pseudo', false)`), `order-regels-table.tsx` (vervangt eigen `ADMIN_PSEUDO_ARTIKELNRS`-Set). `OrderRegelFormData.is_pseudo` toegevoegd; `applyShippingLogic` zet de flag op de geconstrueerde VERZEND-regel. `OrderRegel` interface uitgebreid; `fetchOrderRegels` joint en mapt `producten.is_pseudo`.
- Scope-comments op `SHIPPING_PRODUCT_ID`, `is-shipping-regel.ts`, `pickbaarheid.ts` (3 callsites) en `facturen.ts` banner-detect — die blijven specifiek per-artikelnr omdat ze TOE-VOEG- of per-type-display-semantiek bedienen, niet generieke skip.
- `scripts/lint-no-hardcoded-admin-pseudo-strings.sh` — voorkomt regressie op nieuwe hardcoded strings buiten whitelist.
- CLAUDE.md bedrijfsregel "Admin-pseudo-orderregels symmetrisch overslaan" vereenvoudigd: nieuwe admin-pseudo = pure `UPDATE producten SET is_pseudo=TRUE`, geen code-edit.

**Resultaat:** Toekomstige 4e/5e admin-pseudo (bv. `STAAL`, `MONSTER`, `ADMINFEE`) = pure DB-INSERT zonder redeploy. De N²-recursiebug-klasse van vanochtend is categorisch uitgesloten — er is geen string-lijst meer om uit te breiden.

## 2026-05-13 — Mig 270: Verzonden-orders niet meer in levertijd-view + sub-rij

**Waarom:** Op ORD-2026-2057 (status `Verzonden`, regel 5× SANDRO 771110005)
toonde het orderdetail tegelijk een rode "Wacht op inkoop"-badge op de regel én
een sub-rij "Wacht op nieuwe inkoop 5". Logisch tegenstrijdig — een verzonden
order kan niet wachten op inkoop.

**Root-cause:** zelfde klasse defect als mig 269 (admin-pseudo-asymmetrie),
andere conditie. View `order_regel_levertijd` rekent `levertijd_status` puur
uit `te_leveren − aantal_voorraad − aantal_io > 0`, en de frontend
`buildSubRows` rendert een synthetische "Wacht op nieuwe inkoop"-rij op
dezelfde rekensom. Bij Verzonden/Geannuleerd zet mig 259 alle actieve claims
op `released` (correct), dus `aantal_voorraad=0, aantal_io=0`, tekort =
`te_leveren`. Beide locaties checkten niet of de order in eindstatus zit.

**Wat:**

- **Mig 270** sluit orders in eindstatus (`Verzonden`, `Geannuleerd`) uit van
  view `order_regel_levertijd` via een extra WHERE-clausule, symmetrisch met
  het admin-pseudo-filter dat mig 269 toevoegde. Frontend rendert de
  levertijd-cel daardoor als '—'. Idempotent (DROP + CREATE).
- **Frontend** `order-regels-table.tsx`: nieuwe prop `orderStatus`. Bij
  eindstatus wordt `buildSubRows` overgeslagen — geen claim-uitsplitsing en
  geen "Wacht op nieuwe inkoop"-rij meer voor verzonden / geannuleerde orders.
  `order-detail.tsx` geeft `order.status` door.

**Verificatie ná deploy:**
- ORD-2026-2057: regel 1 levertijd-cel toont '—' i.p.v. "Wacht op inkoop";
  geen sub-rij meer.
- Diagnostic-script `scripts/diagnose-ord-2026-2057.sql` (§6) telt hoeveel
  andere Verzonden/Geannuleerd-orders historisch hetzelfde symptoom hadden
  (pure read — schiet nu leeg ná deploy).

## 2026-05-13 — Mig 269: order-status + levertijd-view skippen admin-pseudo's

**Waarom:** Op ORD-2026-2063 toonde het orderdetail "Wacht op voorraad" op
order-niveau én een rode "Wacht op nieuwe inkoop"-badge op de VERZEND-regel,
terwijl de enige product-regel ruim uit voorraad was geclaimd.

**Root-cause:** asymmetrie in admin-pseudo-filtering tussen lagen. Mig 263/266
filteren `VERZEND` / `BUNDELKORTING` / `DREMPELKORTING` uit de allocator-keten
(geen claims), maar:

- `herbereken_wacht_status` (mig 218) ziet de VERZEND-orderregel (`te_leveren=1`,
  geen claim) als tekort → zet de hele order op `Wacht op voorraad`.
- View `order_regel_levertijd` (mig 156) doet dezelfde rekensom op regel-niveau
  → toont `wacht_op_nieuwe_inkoop` op een service-regel.

Pas zichtbaar geworden ná mig 263/266 + 265: vóór die fixes werd er voor VERZEND
soms tóch een claim gemaakt (of crashte de keten); nu blijft de claim consistent
afwezig.

**Wat:**

- **Mig 269** patcht `herbereken_wacht_status` en view `order_regel_levertijd`
  om VERZEND/BUNDELKORTING/DREMPELKORTING expliciet over te slaan — exact
  hetzelfde filterpatroon als mig 263/266. Idempotent (`CREATE OR REPLACE`).
- **Retroactief-script** `scripts/retroactief-mig-269-herbereken-wacht-status.sql`
  roept `herbereken_wacht_status` aan voor alle non-eind-orders zodat orders
  die nu ten onrechte `Wacht op voorraad` of `Wacht op inkoop` zijn, terugvallen
  naar `Nieuw`. Geen schade bij orders die wél een echt tekort hebben — de
  RPC is idempotent en no-op als status al klopt.

**Verificatie ná deploy:**
- ORD-2026-2063: `status='Nieuw'`, regel 1 levertijd_status=`voorraad`,
  VERZEND-regel verschijnt niet meer in `order_regel_levertijd`.
- `RAISE NOTICE`-output in het retroactief-script laat zien hoeveel orders
  van `Wacht op voorraad`/`Wacht op inkoop` → `Nieuw` schuiven.

## 2026-05-13 — Recursie-fix admin-orderregels + heractivatie orderregel-mirror

**Waarom:** Sinds mig 261/264 crashte INSERT van een orderregel met
`artikelnr ∈ ('VERZEND','BUNDELKORTING','DREMPELKORTING')` op een
`stack depth limit exceeded`. Daardoor stond de orderregel-spiegel van de
bundel-korting (mig 264) uit en bleef `SUM(orderregels per order)` groter
dan het factuur-totaal (zie [vervolg-plan](superpowers/plans/2026-05-13-vervolg-orderregel-mirror-recursiebug.md),
FACT-2026-0019 discrepantie € 70).

**Wat:**

- **Mig 265** voegt de drie pseudo-producten (`VERZEND`, `BUNDELKORTING`,
  `DREMPELKORTING`) idempotent toe aan `producten`. Tot nu toe waren ze
  handmatig ingevoegd op de live DB; bij een fresh deploy crashte de eerste
  bundel-factuur op de FK-constraint.
- **Mig 266** patcht `trg_orderregel_herallocateer` (mig 146) met een
  admin-artikelnr-skip. Admin-pseudo-producten hebben geen voorraad/IO-
  allocatie en triggerden via `herallocateer_orderregel` →
  `herwaardeer_order_status` → `herwaardeer_claims_voor_order` → loop alle
  niet-admin regels → `herallocateer_orderregel` een N²-recursie. Mig 263
  filterde admin-regels al binnen de loop; mig 266 sluit het tweede pad
  (trigger-A bij admin-INSERT) symmetrisch af.
- **Mig 264 re-deploy** herintroduceert de orderregel-spiegel in
  `genereer_factuur_voor_bundel` (1e order = `DREMPELKORTING` bij
  `gratis_drempel`, overige = `BUNDELKORTING` van −verzendkosten).
- **Retroactief-script** `scripts/retroactief-orderregels-fact-2026-0019.sql`
  haalt ORD-2026-2057/2058 alsnog op de juiste regel-stand.

**Mig 267 — root-cause fix:** mig 263 + 266 dekken alleen admin-INSERTs.
Bij een gewone product-INSERT (bv. via "Nieuwe order"-UI) crashte het
systeem alsnog op `stack depth limit exceeded`, want de cyclus
`herallocateer_orderregel → herwaardeer_order_status → herwaardeer_claims_voor_order
→ herallocateer_orderregel` blijft draaien zodra een product-regel zichzelf
in de loop tegenkomt. De werkelijke root-cause: mig 254 voegde `PERFORM
herwaardeer_claims_voor_order(p_order_id)` toe aan de
`herwaardeer_order_status`-wrapper. Vóór mig 254 (mig 218-versie) deed die
wrapper géén claim-loop — alleen status-bepaling + afleverdatum-sync.
Mig 267 herstelt de mig-218-versie. Beide bestaande callers
(`herallocateer_orderregel` + `boek_io_ontvangst_claims`) doen het claim-werk
zélf en hebben de wrapper-loop niet nodig. `herwaardeer_claims_voor_order`
blijft beschikbaar als publieke RPC voor explicit-loop-callers.

**Mig 268 — korting-factuur-regels gespreid per order:** vóór mig 268 misten
BUNDELKORTING/DREMPELKORTING op factuur-niveau zowel `order_nr` als
`uw_referentie`. Daardoor viel de UI terug op `#<order_id>` en groepeerde de
PDF-template ze onder een lege "Ons Ordernummer :"-sectie. Daarnaast was
BUNDELKORTING op de factuur gekoppeld aan `v_order_ids[1]` terwijl de
orderregel-mirror BUNDELKORTING op `v_order_ids[2..]` plaatst — factuur en
order spraken elkaar tegen. Mig 268 spreidt de korting symmetrisch met de
orderregel-mirror (DREMPEL op order[1], BUNDEL per order[2..N]) en vult
`order_nr` + `uw_referentie` via lookup naar `orders`. PDF groepeert nu
automatisch onder de juiste "Ons Ordernummer"-sectie.

**Code-review pickups (in mig 268 + scripts, vóór deploy):**

- Orderregel-mirror gesplitst in twee aparte IFs zodat **N=1 + `gratis_drempel`**
  óók een DREMPELKORTING-orderregel krijgt. Vóór de fix gold de DREMPEL-tak
  alleen binnen `v_aantal_verzend_regels > 1` waardoor single-order zending
  boven drempel wel een DREMPEL-factuurregel kreeg maar geen orderregel
  (discrepantie + verzendkosten).
- Retroactief-script `retroactief-fact-2026-0019-korting-order-koppeling.sql`
  pakt nu `FOR UPDATE` op de factuur-SELECT zodat de Concept-guard niet
  geraced kan worden door een status-flip.
- Verifieer-script gebruikt `strpos(...) > 0` i.p.v. POSIX-`~`-regex
  (laatste matcht geen newlines binnen `pg_get_functiondef`-output).
- Mig 264 header-comment gemarkeerd als "vervangen door mig 268".
- Mig 263 + 266 COMMENT-strings genuanceerd: sinds mig 267 zijn de
  admin-filters strikt redundant, maar blijven als defensieve guard.

**Deploy-volgorde:**

1. Mig 265 — pseudo-producten
2. Mig 266 — trigger A admin-skip
3. Mig 267 — wrapper-revert (breekt de productregel-cyclus)
4. Mig 268 — korting-factuur-regels per order gespreid
5. `scripts/retroactief-orderregels-fact-2026-0019.sql` — orderregel-mirror
   voor bestaande FACT-2026-0019 (`BEGIN/COMMIT`)
6. `scripts/retroactief-fact-2026-0019-korting-order-koppeling.sql` —
   fix order_id/order_nr/uw_referentie op bestaande korting-factuur-regels
7. Sanity: `SELECT order_nr, SUM(bedrag) FROM order_regels orr JOIN orders o
   ON o.id=orr.order_id WHERE o.id IN (...ORD-2057, ORD-2058...) GROUP BY 1;`
   moet matchen met factuur-totaal per order.
8. UI-smoke: nieuwe order aanmaken via "Nieuwe order"-UI — moet zonder
   stack-depth-error opslaan.
9. PDF-smoke: open FACT-2026-0019.pdf — BUNDELKORTING moet onder
   "Ons Ordernummer : ORD-2026-2058" staan, DREMPELKORTING onder
   "Ons Ordernummer : ORD-2026-2057".

## 2026-05-13 — Order-fase zichtbaar in orders-overzicht (ADR-0016)

**Waarom:** "Nieuw" was een vergaarbak-status — orders bleven daarop hangen
terwijl ze allang in pickronde / wacht-op-maatwerk / deels-verzonden zaten.
Daarnaast: orders die in dezelfde zending waren gebundeld (4D-bundel-sleutel,
ADR-0010) toonden hun bundel-verband nergens in het overzicht, ook al deelden
ze één factuur. Tenslotte was de factuur-stand (Verstuurd/Betaald/Aanmaning)
alleen zichtbaar nadat je doorklikte.

**Wat:**

- **ADR-0016** legt de beslissing vast: order_status uitbreiden i.p.v.
  UI-afgeleid; bundel-zichtbaarheid via M2M; factuur-status als badge.
- **Mig 257** voegt 4 nieuwe waarden toe aan `order_status` ENUM:
  `Klaar voor picken`, `Wacht op maatwerk`, `In pickronde`, `Deels verzonden`.
  Twee nieuwe `order_event_type`-waarden: `pickronde_gestart`, `deels_verzonden`
  + `backfill_fase_normalisatie` voor audit.
- **Mig 258** voegt commands `markeer_pickronde_gestart` en
  `markeer_deels_verzonden` toe (ADR-0006-contract via `_apply_transitie`),
  breidt `herbereken_wacht_status` uit met maatwerk-detectie (snijplannen
  status≠'Ingepakt' → 'Wacht op maatwerk'), splitst `voltooi_pickronde` tussen
  laatste-zending (→ Verzonden) en niet-laatste (→ Deels verzonden), en hookt
  `start_pickronden` in op `markeer_pickronde_gestart`. Backfill classificeert
  bestaande 'Nieuw'-orders volgens 4-stappen-prioriteit.
- **Mig 259** breidt `orders_list` view uit met 3 bundel-kolommen
  (`bundel_zending_id`, `bundel_zending_nr`, `bundel_order_count`) gebaseerd
  op `zending_orders` M2M.
- **Frontend:**
  - Nieuwe hook [`useBundelGroupedOrders`](../frontend/src/components/orders/use-bundel-grouped-orders.ts)
    groepeert orders met dezelfde `bundel_zending_nr` als accordion-rij.
  - [`OrdersTable`](../frontend/src/components/orders/orders-table.tsx) rendert
    bundel-header (terracotta tint + chevron + Package-icoon + truck-label
    "Bundel ZEND-... · N orders · KLANT") met expand naar individuele orders.
  - Factuur-cel toont mini-`StatusBadge` naast factuurnr (Verstuurd/Betaald/
    Aanmaning-kleuren); bij multi-factuur wint hoogste actie-prioriteit
    (Aanmaning > Herinnering > Verstuurd > Concept > Betaald > Gecrediteerd).
  - [`StatusTabs`](../frontend/src/components/orders/status-tabs.tsx) ruimt
    legacy spook-statussen op (In snijplan, In productie, Deels gereed, Klaar
    voor verzending) en toont de nieuwe fase-tabs. 'Klaar voor picken'-tab
    combineert backwards-compat met legacy 'Nieuw'.
  - 'Actie vereist'-tab is nu union van Wacht op voorraad ∪ Wacht op inkoop ∪
    heeft_unmatched_regels.

**Deployment-volgorde (hard):** mig 257 commit → mig 258 commit → mig 259 →
frontend-merge. ENUM-uitbreiding moet vóór de RPC-update in een aparte
transactie omdat Postgres `ADD VALUE` + gebruik niet in één tx toestaat.

**Verificatie:**
- Hook-test (4 cases) + bestaande bundel-korting + facturatie-tests groen.
- TypeScript check zonder errors.
- SQL-contract na backfill (handmatig na deploy): `SELECT COUNT(*) FROM orders
  WHERE status='Nieuw'` → 0; `'In pickronde'`-count = open zendingen via M2M.

**Niet in scope (V2-backlog):** voorgestelde-bundels in overzicht; betaalstatus
op order-niveau; `Nieuw`-default in `create_webshop_order` opruimen.

## 2026-05-13 — Inkoop-Module als deep Module ([ADR-0017](adr/0017-inkoop-als-deep-module.md))

Inkooporders, leveranciers en de ontvangst-flow zijn geëxtraheerd als twaalfde deep verticale Module onder `frontend/src/modules/inkoop/` — naast Reservering (ADR-0015), Snijplanning, Facturatie, Debiteur en de eerdere tien.

- **Twaalfde deep verticale Module**: `modules/inkoop/` met queries, hooks, components, pages. Medium scope (logica-laag + UI). Routes blijven `/inkoop` en `/leveranciers` voor bookmark-compat (precedent: Debiteur-Module met `/klanten`-routes).
- **Mig 271**: pure rename `boek_voorraad_ontvangst → boek_inkooporder_ontvangst_stuks`, `boek_ontvangst → boek_inkooporder_ontvangst_rollen`. Bodies identiek. Oude namen blijven DEPRECATED thin wrappers (1 release; verwijderen in vervolg-migratie). `boek_io_ontvangst_claims` (Reservering, mig 254) onaangeraakt — stuks-pad delegeert claim-consume daaraan.
- **Slot-component** `<InkoopRegelSamenvatting>` (regel + parent-IO + leverancier in één call) geconsumeerd door Reservering's `RegelClaimDetail` — cross-Module zonder hooks-import, patroon analoog aan `<KlantBenaming>` (ADR-0011) en `<VervoerderTag>` (ADR-0008).
- **Python `import_inkoopoverzicht.py`**: TODO-banner verwijst naar `create_inkooporder`-RPC backlog; pad expliciet gewhitelist in lint-script.
- **Lint-script** `scripts/lint-no-direct-inkooporder-regel-write.sh` + **ESLint** `no-restricted-imports` beschermen Module-boundary tegen directe `inkooporder_regels`-writes en directe imports buiten de Module.
- **Cleanup**: 4 legacy files verwijderd (toplevel hooks + shims), incl. duplicate `useBoekOntvangst` met afwijkende invalidation-keys.
- **Backward-compat thin wrappers** `boek_voorraad_ontvangst` / `boek_ontvangst` staan op deprecation; verwijderen in vervolg-migratie.
- **Open backlog**: rol-creatie + `voorraad_mutaties`-INSERT verhuist naar toekomstige Voorraad/Producten-Module; inkoopgroepen-pages (klant-attribuut, ondanks de naam) verhuist naar Debiteur-Module; `create_inkooporder`-RPC vervangt initial-bulk-create Python-flow.

## 2026-05-13 — Bundel-korting zichtbaarheid

**Waarom:** Bij bundeling van zendingen werd de verzendkosten-besparing
niet zichtbaar voor de klant — factuur toonde alleen € 0 of stilzwijgend
1 i.p.v. 2 verzend-regels. Behoefte: communiceer als service.

**Wat:**
- Mig 256: `genereer_factuur_voor_bundel` splitst bij drempel-gehaald in
  2 factuurregels: `VERZEND € X` + `BUNDELKORTING −€ X` (D2-vorm).
  BTW: zelfde % met negatief bedrag. Saldo blijft € 0.
- Nieuw artikelnr-conventie: `BUNDELKORTING` voor de tegenboeking.
- Frontend: `BundelKortingBanner` in `OrderFacturen` toont per factuur
  een groene info-strip met scenario-specifieke tekst:
  - A (drempel-korting): "Verzendkosten weggestreept op FACT-X"
  - B (multi-order zonder drempel): "1× i.p.v. 2× — bespaart € X"
- Banner verschijnt pas vanaf factuur-bestaan (W3-besluit) — niet bij
  voorgestelde bundels die nog kunnen veranderen.
- Legacy verstuurde facturen met dubbele VERZEND-regels: niets doen
  (E1). Script `check-legacy-dubbele-verzendkosten.sql` produceert
  feitenlijst voor naslag.

**Deployment-volgorde:** mig 252 → mig 256 → feitenlijst → merge-script
→ frontend.

## 2026-05-13 — Snijden: handmatige override van reststuk-maten en aangebroken-lengte

In het "Rol snijden"-menu ([RolUitvoerModal](../frontend/src/components/snijplanning/rol-uitvoer-modal.tsx)) waren de reststuk- en aangebroken-rol-afmetingen tot nu toe puur de auto-berekende waarden uit [`computeReststukkenAngebrokenAfval`](../frontend/src/modules/snijplanning/lib/compute-reststukken.ts). Bij een menselijke fout op de guillotine (bv. lengte-mes net iets te kort gezet) kwam de werkelijke voorraad daardoor niet meer overeen met wat het systeem registreerde.

**Implementatie:** de breedte- en lengte-velden in de reststuk-rijen en het lengte-veld in de aangebroken-rol-rij zijn nu inline `<input type="number">` met smalle emerald/blue rand, default gevuld met de auto-berekende maat. Een wijziging wordt opgeslagen in lokale state (`reststukOverrides` per letter R1/R2/…, `aangebrokenLengteOverride`) en gevoed terug in `buildSnijVolgorde` — zo blijven de tabel, de sticker-preview (`printReststukSticker`) en de bulk-stickers (sessionStorage in `printBulk`) één single source of truth. Bij `Rol afsluiten` wordt de override-versie doorgegeven aan RPC [`voltooi_snijplan_rol`](../supabase/migrations/251_voltooi_snijplan_rol_voorraad_mutaties_schema_fix.sql). Een reset-link verschijnt naast elke gewijzigde rij. Inline-waarschuwingen: ⚠ wanneer reststuk onder 70×140 cm zakt (wordt afval) of aangebroken-lengte onder 100 cm (rol gaat naar `gesneden` i.p.v. aangebroken). RPC zelf hoefde niet aangepast — die accepteerde al `breedte_cm`/`lengte_cm` per rect in JSONB en `p_aangebroken_lengte` als int.

## 2026-05-13 — Reservering-Module als deep Module ([ADR-0015](adr/0015-reservering-als-deep-module.md))

Reservering / allocator-logica is geëxtraheerd als elfde deep Module onder `frontend/src/modules/reserveringen/`, naast Orders-lifecycle, Facturatie en Snijplanning. Eigendomsgrens: allocator (`herallocateer_orderregel`), handmatige uitwisselbaar-claims, IO-claim-release op annulering, `producten.gereserveerd`-cache via trigger en de TS-spiegel `berekenRegelDekking` met SQL-contract via de nieuwe `simuleer_dekking()`-RPC.

**Backend-split mig 254:** god-orchestratie `herwaardeer_order_status` wordt thin wrapper boven drie expliciete aanroepen — `herwaardeer_claims_voor_order` (Reservering-Module), `herbereken_wacht_status` (Order-lifecycle-Module, mig 218) en tijdelijk `sync_order_afleverdatum_met_claims` (Reservering, blijft hier tot de Levertijd-Module bestaat). Nieuwe Module-eigen RPCs: `herwaardeer_claims_voor_order`, `simuleer_dekking`, `boek_io_ontvangst_claims`.

**Backend mig 255:** trigger op `orders.status` vervangen door listener op `order_events`-INSERT met `event_type IN ('geannuleerd', 'pickronde_voltooid')` — symmetrie met de Facturatie-Module ([ADR-0007](adr/0007-facturatie-als-deep-module.md)). Eén bron-van-waarheid voor status-overgangen blijft `_apply_transitie` in Order-lifecycle.

**Backend mig 256 (review-fix):** trigger-WHEN-conditie uitgebreid met `'pickronde_voltooid'` plus eenmalige back-fill. Mig 255 luisterde initieel alleen op `'geannuleerd'`, waardoor claims na verzending `status='actief'` bleven en `voorraad_beschikbaar_voor_artikel` (mig 154) ze ten onrechte meetelde. Oude mig 146-trigger releasete claims óók bij Verzonden-transities — dekking hiermee hersteld.

**Frontend-verhuizing:** queries, hooks, lib en vier components (reserveringen-overzicht, claim-uitsplitsing, uitwisselbaar-tekort-hint en handmatige-claim-editor) verhuisd naar de Module-folder. Caller-cleanup compleet (geen shims meer). Cache-seam: `invalidateNaReserveringsmutatie(qc)` via `cache.ts` — aangeroepen vanuit order-form save-flow zodat uitwisselbaar-mutaties geen stale UI achterlaten. Lint: `scripts/lint-no-direct-order-reserveringen-write.sh` voorkomt directe `order_reserveringen`-writes buiten de Module.

## 2026-05-13 — Zendingen-overzicht: bundel-orders zichtbaar in lijst

Op `/logistiek` (zendingen-overzicht) toonde elke rij alleen de primaire `orders.order_nr` van de zending. Bij een gebundelde zending (mig 222, 4D-bundel-sleutel) — bijvoorbeeld ZEND-2026-0014 met 2 orders — was vanuit de lijst niet te zien dat er meer dan één order in de zending zat; je moest doorklikken naar de detail om dat te ontdekken.

**Implementatie:** [`fetchZendingen`](../frontend/src/modules/logistiek/queries/zendingen.ts) haalt nu de M2M `zending_orders` mee (zelfde join als `fetchZendingMetTransportorders`/`fetchZendingPrintSet`). De Order-kolom in [`zendingen-overzicht.tsx`](../frontend/src/modules/logistiek/pages/zendingen-overzicht.tsx) stackt alle order_nrs verticaal (gesorteerd alfabetisch) en toont eronder een lichte `Bundel · N orders`-label zodra het er meer dan één zijn. Fallback op de primaire `orders.order_nr` als de M2M leeg is (oude rijen vóór backfill).

**Verificatie:** open `/logistiek`, zoek een bundel-zending (ZEND-2026-0014 op screenshot van 13-05 bevat ORD-2026-2057 + 1 extra). Beide order_nrs verschijnen in de Order-kolom, met "Bundel · 2 orders"-label eronder. Solo-zendingen ongewijzigd (geen label).

## 2026-05-11 — Prijs-resolver: vaste-maat verkoopprijs vóór m²-fallback

Bij ORD-2026-2056 (klant JANSEN TOTAAL WONEN, artikel 771110006 DUTCHZ 3601 SEINE — een vaste-maat voorraadartikel 200×290 cm) berekende [`bereken_orderregel_prijs`](../supabase/migrations/191_bereken_orderregel_prijs.sql) (mig 191) een prijs van €202,94 via route 3 (`maatwerk_artikel_m2`): 5,80 m² × €34,99/m² uit het generieke MAATWERK-broertje 771119998. Logisch voor échte maatwerk-producten, onhandig voor vaste maten — de eigen `producten.verkoopprijs` werd genegeerd zolang de klant-prijslijst geen expliciete regel had voor het artikel.

**Implementatie:** [mig 253](../supabase/migrations/253_bereken_orderregel_prijs_vaste_maten.sql) voegt route **1b `product_vaste_verkoopprijs`** toe direct na route 1 (`prijslijst_vast`) en vóór de m²-fallbacks. Activeert alleen voor producten die zelf GEEN maatwerk-artikel zijn — detectie via `omschrijving`/`karpi_code NOT LIKE '%MAATWERK%'` (spiegelt de detectie in route 3) — én een `verkoopprijs > 0` hebben. Maatwerk-producten zelf doorlopen onveranderd routes 2-6.

**Frontend:** `PrijsBron`-type in [`order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts) uitgebreid met `'product_vaste_verkoopprijs'`. In [`prijs-bron.ts`](../frontend/src/lib/utils/prijs-bron.ts) gemarkeerd als "schone" bron (lege label, emerald-kleur — tooltip legt uit dat het uit de producten-tabel komt). In [`order-line-editor.tsx`](../frontend/src/components/orders/order-line-editor.tsx) toegevoegd aan de hint-uitsluitingsset (geen ruis-regel onder de prijs-input) en aan `origineelHeeftPrijs` (anders triggert de omsticker-substitutie-flow onnodig).

**Impact-check:** [`scripts/check-impact-mig-253.sql`](../scripts/check-impact-mig-253.sql) — twee blokken: (1) per artikel het verschil tussen huidige fallback-prijs en eigen verkoopprijs voor regels uit de laatste 90 dagen; (2) verdeling van unieke (artikel × prijslijst) over bron-routes. Run dit vóór mig 253 toe te passen om te zien welke kant prijzen op bewegen (klant betaalt meer/minder) en hoeveel artikelen het raakt.

**Backward-compatible:** bestaande orderregel-prijzen zijn al opgeslagen — deze RPC bepaalt enkel nieuwe prijzen bij order-aanmaak of artikel-wissel. Bestaande klant-prijslijst-vast-entries (route 1) behouden hun voorrang.

**Verificatie:** na deploy `SELECT bereken_orderregel_prijs('771110006', (SELECT prijslijst_nr FROM debiteuren WHERE debiteur_nr = 403900))` — verwacht `bron='product_vaste_verkoopprijs'` met de eigen `producten.verkoopprijs` (i.p.v. €202,94). Open `/orders/aanmaken`, voeg 771110006 toe voor JANSEN TOTAAL WONEN: prijs-veld vult zich met de eigen verkoopprijs, géén oranje "m² uit maatwerk-artikel"-hint meer onder het input.

## 2026-05-11 — Pick & Ship: dag-orders als aparte top-sectie

Op de Pick & Ship-overview verdwenen dag-orders (`lever_type='datum'`, ADR-0014) tussen de week-orders binnen dezelfde verzendweek-groep. Bijvoorbeeld ORD-2026-2052 met afleverdatum "di 12-05" stond gemengd met de twee Floorpassion-week-orders in dezelfde Week 20-bucket — het kalender-badge op de card was de enige aanwijzing dat het om een specifieke leverdag ging. Voor de magazijnier maakt dat onderscheid juist het verschil: dag-orders hebben een harde afleverdag-belofte en moeten daadwerkelijk vandaag of morgen de deur uit.

**Implementatie:** nieuwe component [`PickDagOrdersSectie`](../frontend/src/modules/magazijn/components/pick-dag-orders-sectie.tsx) rendert dag-orders in een eigen terracotta-omkaderde sectie bovenaan de overview, gesorteerd op afleverdatum ASC. De `KlantClusterBlok` is geëxtraheerd naar [eigen bestand](../frontend/src/modules/magazijn/components/klant-cluster-blok.tsx) en wordt door zowel `PickWeekSectie` als de nieuwe dag-sectie hergebruikt — bundel-clustering, land-groepering en pickronde-start-knop werken identiek voor beide. In [`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx) wordt het na-vervoerder-filter gesplitst in `dagOrders` / `weekOrders`; de bestaande `perWeek`-groepering ontvangt alleen nog week-orders.

**Effect:** dag-orders staan visueel boven aan met urgent-terracotta kop "Op leverdatum"; de week-buckets eronder zijn nu zuiver week-orders. Dag-orders die binnen dezelfde 4D-bundel-sleutel vallen (debiteur × adres × vervoerder × ISO-week) clusteren onverminderd door — een bundel-zending met gemengde dag/week-orders is fysiek nog steeds één rit.

**Verificatie:** open `/pick-ship` met minimaal één order met `lever_type='datum'` waarvan de pick-horizon is geraakt (≤1 werkdag vóór afleverdatum). De order verschijnt boven aan in een terracotta-omkaderde "Op leverdatum"-sectie; week-orders staan in hun eigen "Te picken in week N · Verzendweek M"-secties eronder. Dag-orders met dezelfde adres+vervoerder+ISO-week bundelen normaal samen.

## 2026-05-11 — Hotfix: `voltooi_confectie` gooit `column "status" is of type snijplan_status but expression is of type text`

**Symptoom:** in de Confectielijst gaf "Afronden" met checkbox Ingepakt aan een Supabase-fout `column "status" is of type snijplan_status but expression is of type text` — de modal hing op het inboeken, het stuk verscheen niet in Pick & Ship.

**Root cause:** [mig 247](../supabase/migrations/247_voltooi_confectie_ingepakt_status.sql) herdefinieerde `voltooi_confectie` met een CASE-expressie waarvan de drie THEN-takken naakte string-literals waren (`'Ingepakt'` / `'In confectie'` / `'Gesneden'`). PostgreSQL leidt het resultaattype van zo'n CASE af als `text`, en past **geen** impliciete cast meer toe op het UPDATE-target — net zoals bij een directe `SET enumcol = 'text'`. PL/pgSQL parst de body lazy bij aanroep, dus de migratie zelf slaagde; de fout kwam pas bij de eerste echte call uit de Confectielijst. Dezelfde structuur in oudere `voltooi_confectie`-versies (mig 101 in git history) was puur geluk — daar zaten de literals óók al fout, maar bij vroegere PG-versies kwam de impliciete coercie er nog mee weg.

**Fix:** [mig 250](../supabase/migrations/250_voltooi_confectie_enum_cast_fix.sql) — elke THEN-tak van de CASE krijgt een expliciete `::snijplan_status`-cast, idem voor de `status IN (...)`-clause. Signatuur en gedrag ongewijzigd, alleen typing. `CREATE OR REPLACE` overschrijft mig 247.

**Let op — duplicate mig 245:** in de staging area stond `245_voltooi_confectie_ingepakt_status.sql` met identieke (foute) inhoud als mig 247. Naast 245 staat ook 245_order_rpcs_lever_type.sql gecommit — nummerconflict. Mig 245 (de confectie-duplicate) is nu obsolete door mig 250; aanrader om hem te unstagen + verwijderen om dubbele uitvoer te voorkomen.

**Verificatie:** open `/confectie`, kies een stuk met status `Gesneden` of `In confectie` → "Afronden" → check `Ingepakt` aan + locatie ingevuld → "Opslaan" → modal sluit zonder foutmelding → stuk verdwijnt uit Confectielijst en verschijnt in `/pick-ship` onder de juiste order.

## 2026-05-11 — Levertijd-suggestie: "eerder haalbaar"-hint + spoed-UI uit

Twee veranderingen aan de real-time levertijd-suggestie op `/orders/aanmaken`:

**1. Dode imports `check-levertijd` opgelost (hotfix)** — De suggestie toonde voor élke maatwerk-regel "Real-time levertijd-check niet beschikbaar. Indicatie: …", óók bij voldoende voorraad. De fallback-datum kwam door via `bepaalOrderAfleverdatum`, dus de UI bleef bruikbaar, maar de operator zag nooit het scenario-badge.

Root cause: [check-levertijd/index.ts](../supabase/functions/check-levertijd/index.ts) importeerde `fetchUitwisselbarePairs` (Engels) en `fetchUitwisselbareCodes` uit [_shared/db-helpers.ts](../supabase/functions/_shared/db-helpers.ts). Beide functies bestonden niet meer — in commit `ce6136e` (mig 138 `uitwisselbare_paren_canoniek`) vervangen door één Nederlandse `fetchUitwisselbareParen`. De andere consumers (`auto-plan-groep`, `optimaliseer-snijplan`) waren wél meegenomen, alleen de levertijd-functie niet. Deno faalde dus al bij module-load → élke invoke 500'de → `useQuery` zette `error` → fallback-strook.

Fix: import vervangen + `fetchUitwisselbareCodes`-fallback geschrapt (self-row is gegarandeerd in de canonieke RPC). Omdat `fetchUitwisselbareParen` genormaliseerde kleur-codes teruggeeft, vouwen we elke paar nog uit met `getKleurVariants` voordat we de rollen-OR-clause bouwen — anders missen we rollen waarvan `kleur_code` nog "12.0" is i.p.v. "12".

**2. "Eerder haalbaar"-hint + spoed-toggle uit de UI** — Vervolg-vraag van de operator: bij lege planning toonde de suggestie alsnog 4 weken vooruit (de standaard `maatwerk_weken=4`-belofte), terwijl het systeem zelf wist dat het sneller kon — alleen werd dat alleen aangeboden via de spoed-toggle met €50 toeslag. Beleid: standaard 4 weken blijft, maar laat zien wanneer het zonder toeslag eerder zou kunnen zodat verkoop dat met de klant kan communiceren.

Implementatie: de edge function draait nu een tweede [`capaciteitsCheck`](../supabase/functions/_shared/levertijd-capacity.ts) vanaf de huidige ISO-week parallel aan de gewenste-aligned check. [`resolveScenario`](../supabase/functions/_shared/levertijd-resolver.ts) zet `details.eerder_haalbaar = { lever_datum, snij_week, snij_jaar }` alléén wanneer die strikt eerder is dan de gewenste-aligned `lever_datum` — anders zou de hint identiek zijn aan het hoofd-voorstel en alleen ruis voor de operator. [`LevertijdSuggestie`](../frontend/src/components/orders/levertijd-suggestie.tsx) rendert de hint als groene strook met "Neem over"-knop. De spoed-toggle (`SpoedToggle`-helper) is uit de JSX gehaald; de `spoed_*`-config en `evalueerSpoed`-call in de edge function blijven staan zodat de toggle later weer aan kan zonder backend-werk. De urgent-banner (gewenste binnen 2 dagen → "bel productie") blijft als veiligheid.

**Verificatie:** open `/orders/aanmaken`, klant + maatwerk-regel met lege planning. Hoofdregel toont nog 4 weken vooruit (standaard-belofte); daaronder groene strook "Eerder haalbaar: 18-05-2026 — snijden in week 21" met knop om die datum over te nemen. Géén spoed-toggle meer onderaan de card.

## 2026-05-11 — Order-aanmaken: factuuradres + factuur/orderbev-e-mail inline wijzigbaar

Op de order-aanmaken/bewerken-pagina was het factuuradres tot nu toe alleen read-only zichtbaar en de e-mailadressen voor facturen / orderbevestigingen alleen via de aparte klant-detailpagina te bewerken. Voor klanten waar deze velden in de praktijk regelmatig wijzigen (verhuizing, nieuwe administratie-contactpersoon) een onnodige omweg.

**Implementatie:** nieuw component [`InvoiceAddressEditor`](../frontend/src/components/orders/invoice-address-editor.tsx) vervangt de read-only `AddressPreview` voor factuuradres. "Wijzig"-knop opent een inline edit-form met:
- **Adres-velden** (naam/adres/postcode/plaats/land) — kunnen óf alleen voor déze order óf ook als nieuwe debiteur-default opgeslagen worden;
- **Contact-velden**: e-mail facturen (`debiteuren.email_factuur`, gebruikt door [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts)) en e-mail orderbevestiging (`debiteuren.email_overig`). Deze hebben géén per-order snapshot — ze worden alleen op de debiteur opgeslagen;
- **Checkbox "Wijzigingen ook op klantpagina opslaan"** — **standaard aan**, zodat de natuurlijke flow is dat een wijziging in het orderformulier ook de debiteur bijwerkt.

Bij Apply + checkbox aan: `UPDATE debiteuren SET fact_*, email_factuur, email_overig` — daarna lokale `client`-state én React Query-caches `['klanten', debiteur_nr]`, `['klant-factuur-instellingen', debiteur_nr]`, `['client-commercial', debiteur_nr]` geïnvalideerd zodat de Facturering-tab, header-email en commerciële instellingen overal vers zijn. Bij checkbox uit: alleen `header.fact_*` lokaal gemuteerd (e-mails worden genegeerd want geen per-order snapshot — wordt expliciet als amber hint getoond).

**Koppeling klantpagina:** factuur-email wordt op de klant-detail al getoond via [`klant-facturering-tab.tsx`](../frontend/src/modules/debiteuren/components/klant-facturering-tab.tsx) (gebruikt dezelfde `email_factuur`-kolom + dezelfde query-key) en in de header van [`debiteur-detail.tsx`](../frontend/src/modules/debiteuren/pages/debiteur-detail.tsx); orderbev-email staat daar onder "Email (overig)". Dezelfde kolommen, dezelfde write-pad, dus single source of truth.

**Files:** nieuw [`frontend/src/components/orders/invoice-address-editor.tsx`](../frontend/src/components/orders/invoice-address-editor.tsx). Gewijzigd [`frontend/src/components/orders/order-form.tsx`](../frontend/src/components/orders/order-form.tsx), [`frontend/src/components/orders/client-selector.tsx`](../frontend/src/components/orders/client-selector.tsx) (SelectedClient + query met `email_factuur`/`email_overig`), [`frontend/src/lib/supabase/queries/order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts) (`fetchClientCommercialData` haalt e-mails mee voor edit-flow), [`frontend/src/pages/orders/order-edit.tsx`](../frontend/src/pages/orders/order-edit.tsx).

**Verificatie:** open `/orders/aanmaken`, kies een klant → factuuradres-card toont nu adres + factuur-email + orderbev-email + "Wijzig"-knop → wijzig één veld → checkbox staat **standaard aan** → "Opslaan + toepassen" → open `/klanten/{nr}` in nieuw tabblad → wijziging zichtbaar in header (factuur-email) én op Facturering-tab → maak tweede order voor dezelfde klant → editor toont meteen nieuwe waardes.

## 2026-05-11 — Bugfix: `voltooi_snijplan_rol` gooit `lengte_voor_cm does not exist` bij aangebroken rol

**Symptoom:** in het Rol-snij-dialoog ("Rol afsluiten") gooide de RPC `42703: column "lengte_voor_cm" of relation "voorraad_mutaties" does not exist` zodra de operator een rol als **aangebroken** (volle breedte, verkort) wilde achterhouden. De hele transactie rolde terug → snijplannen bleven op `Snijden`, de rol bleef op `snijden`, geen reststuk en geen grondstofkosten-toerekening.

**Root cause:** migratie 090 schreef `INSERT INTO voorraad_mutaties (rol_id, type, lengte_voor_cm, lengte_na_cm, reden, medewerker) VALUES (..., 'aangebroken', ...)`. Die kolommen zijn nooit in de echte tabel (mig 032) terechtgekomen — en `'aangebroken'` zat niet in het type-CHECK. Migratie 246 herdefinieerde de functie maar wijzigde alleen `DELETE → TRUNCATE` voor de temp-table; de foute INSERT bleef staan. Identiek probleem werd in mig 136 al opgelost voor `boek_ontvangst`, maar voor `voltooi_snijplan_rol` was dat blijven liggen omdat de aangebroken-branch alleen geraakt wordt als de magazijnier "behoud rol (aangebroken, volle breedte)" kiest.

**Fix — Mig 251** [`251_voltooi_snijplan_rol_voorraad_mutaties_schema_fix.sql`](../supabase/migrations/251_voltooi_snijplan_rol_voorraad_mutaties_schema_fix.sql): `CREATE OR REPLACE FUNCTION voltooi_snijplan_rol(...)` met INSERT op de werkelijke `voorraad_mutaties`-kolommen — `type='correctie'` (bestaande toegestane waarde, semantisch een rol-lengte-correctie), `lengte_cm` = nieuwe rol-lengte, `breedte_cm` = onveranderde breedte, `notitie` = vrije tekst met van/naar-waarden voor audit-trail, `referentie_id=rol_id`/`referentie_type='rol_aangebroken'`, `aangemaakt_door=p_gesneden_door`. Rest van de functie (snijplan-status, reststukken-JSONB-flow, grondstofkosten-toerekening) identiek aan mig 246 inclusief TRUNCATE-fix.

**Verificatie**: rol opnieuw afsluiten via Rol-snij-dialoog met "behoud rol (aangebroken)" — snijplannen moeten naar `Gesneden` springen, rol moet `beschikbaar` worden met verkorte lengte, en de mutatie zichtbaar in `voorraad_mutaties` met type=`correctie` + `notitie` "Rol aangebroken na snijden: van X cm naar Y cm".

**Files**: nieuw `supabase/migrations/251_voltooi_snijplan_rol_voorraad_mutaties_schema_fix.sql`. Geen frontend-changes.

## 2026-05-11 — ADR-0014: Leveren op leverdatum naast leverweek (`lever_type`)

Karpi levert in ~90% van de orders per leverweek (B2B): vervoerder haalt op in de afgesproken week, klant ontvangt een week later. Met de groei van B2C (Floorpassion-webshop, particulier maatwerk) komt er behoefte aan **levering op een specifieke dag**. Onder de motorkap werkt het systeem al op `orders.afleverdatum` (DATE); deze release voegt het intentie-vlag `lever_type` toe zodat de UX, pick-horizon en snij-prioriteit zich naar B2C kunnen voegen zonder bundel-/factuur-flow te raken.

**Ingrepen:**

- **Mig 244** [`244_lever_type_dag_of_week.sql`](../supabase/migrations/244_lever_type_dag_of_week.sql): nieuw ENUM `lever_type` ('week' | 'datum'). Kolom `orders.lever_type` (NOT NULL DEFAULT 'week') voor per-order intentie en `debiteuren.default_lever_type` voor klant-default. Seed `app_config.productie_planning.dag_order_snij_buffer_werkdagen=2` + helper-functie `dag_order_snij_buffer_werkdagen()` (zelfde patroon als `confectie_buffer_minuten()` uit mig 103). View `orders_list` herbouwd zodat OrdersTable `lever_type` kan lezen.

- **Mig 245** [`245_order_rpcs_lever_type.sql`](../supabase/migrations/245_order_rpcs_lever_type.sql): `create_order_with_lines` + `update_order_with_lines` lezen `lever_type` uit `p_order`/`p_header`. Achterwaarts compatibel — EDI-import, Floorpassion-webshop en bestaande callers krijgen impliciet 'week' als de key ontbreekt.

- **Order-form toggle** (`LeverDatumField` in [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx)): segmented "Per week / Op datum" boven de afleverdatum-input. Default = `client.default_lever_type`. Bij 'datum' verschijnt een date-picker; bij 'week' blijft de native week-picker. `applyAfleverdatum` blijft de week-snapshot zetten zodat bundel-sleutel ongewijzigd werkt. `OrderFormData.lever_type` toegevoegd; `createOrder` stuurt 'week' default.

- **Klant-default** ([`debiteur-detail.tsx`](../frontend/src/modules/debiteuren/pages/debiteur-detail.tsx)): segmented toggle "Standaard levering" op de info-tab via nieuwe `leverTypeMutation`. B2C-klanten kunnen permanent op 'datum' staan.

- **Pick & Ship-horizon** ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)): dag-orders verschijnen pas vanaf `werkdagMinN(afleverdatum, 1)` in Pick & Ship. Voorkomt dat de magazijnier een dag-belofte te vroeg pickt en wegzet (waarna de pickdag gemist kan worden). Week-orders blijven direct zichtbaar zodra pickbaar — bundeling tussen week en dag werkt door operator-keuze bij `start_pickronden_bundel`. Nieuwe helper `werkdagMinN` in [`bereken-agenda.ts`](../frontend/src/lib/utils/bereken-agenda.ts) en parallel in [`werkagenda.ts`](../supabase/functions/_shared/werkagenda.ts) voor edge-pad.

- **Snij-/levertijd-resolver** ([`check-levertijd/index.ts`](../supabase/functions/check-levertijd/index.ts)): request-contract accepteert `lever_type`. Voor dag-orders schuift de capaciteits-startweek (`snijWeekVoorLever`) naar `werkdagMinN(gewenste_leverdatum, dag_order_snij_buffer_werkdagen)` — d.w.z. de planning rekent vanaf de strikere kritieke deadline (2 werkdagen vóór afleverdatum) i.p.v. de kalender-`logistieke_buffer_dagen`. `LevertijdConfig.dag_order_snij_buffer_werkdagen` toegevoegd; `fetchConfig` leest 'm uit `app_config.productie_planning`.

- **Visuele badges**:
  - Order-detail header ([`order-header.tsx`](../frontend/src/components/orders/order-header.tsx)): dag-orders krijgen het label "Leverdatum" + een terracotta "📅 Specifieke dag"-chip met de geformatteerde dag. Week-orders behouden de huidige "Wk N · YYYY"-weergave.
  - Pick & Ship-card ([`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)): terracotta-chip "do 14-05" voor dag-orders i.p.v. de "Wk N"-tag.
  - Orders-overzicht ([`orders-table.tsx`](../frontend/src/components/orders/orders-table.tsx)): in de "Verzendweek"-kolom rendert een dag-badge voor dag-orders.

- **Niet in deze release (V2-backlog)**: tijdslot per dag, IO-sync-blokkade voor dag-orders (mig 153 schuift nu nog dag-orders vooruit als IO-claims later vallen — visuele badge maakt dit zichtbaar), klant-portaal voor B2C-zelfkeuze, push naar Lightspeed eCom van werkelijke leverdag.

**Beslissingen** (uit overleg, vastgelegd in [ADR-0014](adr/0014-leveren-op-leverdatum-naast-leverweek.md)):

- **Bundeling**: dag- en week-orders mengen wél op de bestaande 4D bundel-sleutel — operator beslist bij `start_pickronden_bundel` of beide samen vertrekken.
- **Pick-horizon**: 1 werkdag vóór afleverdatum.
- **Snij-prioriteit**: ja, 2 werkdagen strikter dan week-orders, configureerbaar via `app_config.productie_planning.dag_order_snij_buffer_werkdagen`.

**Files**: nieuw `supabase/migrations/{244_lever_type_dag_of_week,245_order_rpcs_lever_type}.sql`; nieuw `docs/adr/0014-leveren-op-leverdatum-naast-leverweek.md`. Geüpdatet `frontend/src/components/orders/{order-form,order-header,orders-table}.tsx`, `frontend/src/lib/supabase/queries/{order-mutations,orders}.ts`, `frontend/src/lib/utils/bereken-agenda.ts`, `frontend/src/components/orders/client-selector.tsx`, `frontend/src/pages/orders/order-edit.tsx`, `frontend/src/modules/debiteuren/{queries/debiteuren,pages/debiteur-detail}.tsx`, `frontend/src/modules/magazijn/{queries/{pickbaarheid,pick-ship-transform},lib/types,components/order-pick-card}.{ts,tsx}`, `supabase/functions/{check-levertijd/index,_shared/{levertijd-types,werkagenda}}.ts`, `docs/data-woordenboek.md`. Contract-test `magazijn-pickbaarheid.contract.test.ts` bijgewerkt voor nieuwe `lever_type`-veld in mock-headers.

**Cross-cut behoud**: bundel-sleutel (`bundel_sleutel`, `verzendweek_voor_datum`) en `voorgestelde_zending_bundels`-view ongewijzigd. Wekelijkse-factuur-cron (mig 231-232) ongewijzigd — dag-orders vallen vanzelf in de ISO-week van hun afleverdatum. IO-sync `herwaardeer_order_status` (mig 153) gedraagt zich gelijk voor beide types in V1.

**Verificatie**: handmatige test e2e — week-order op wk 21, dag-order met afleverdatum vandaag+3. Verifieer pickbaarheidsfilter, snij-startweek, visuele badges in Pick & Ship + orders-overzicht + order-detail.

## 2026-05-11 — ADR-0013 uitgevoerd: Snijplanning-Module #10 + cross-Module cache-invalidation seam

Architectuur-skill `/improve-codebase-architecture` losgelaten op de "snijplanning verschijnt niet onder Klaar voor confectie"-bug. Symptoom-fix vs structurele frictie: één regel cache-invalidation toevoegen lost vandaag op, maar het patroon achter het probleem (13 mutation-hooks die handgecodeerd consumer-query-keys opsommen, producer kent consumer) is een fout-magneet. Grilling-sessie koos **solo `modules/snijplanning/`** (geen geneste `planning/`), **medium scope** (logica-laag, components/pages blijven fysiek), en **Module-owned `cache.ts`-helpers** als seam (geen event-bus, geen centrale registry).

**Ingrepen in één PR:**

- **Snijplanning-Module #10** ([ADR-0013](adr/0013-snijplanning-module-en-cache-invalidation-seam.md)): nieuwe folder `frontend/src/modules/snijplanning/` met `queries/` (4 files), `hooks/` (use-snijplanning), `lib/` (compute-reststukken, snijplan-mapping, snij-volgorde/derive + types + test), `cache.ts` en `index.ts`. ±2.3k regels verhuisd. Runtime-components in `components/snijplanning/` en pages in `pages/snijplanning/` blijven fysiek en consumeren via barrel. 16 caller-files geüpdatet naar `@/modules/snijplanning`. Auto-plan-trigger raw-functies (`triggerAutoplan`, `fetchAutoplanningConfig`) expliciet als advanced-caller-export omdat order-form ze inline aanroept in een save-chain buiten React Query.

- **Cross-Module cache-invalidation seam** (ADR-0013, Ingreep 2): elke Module exporteert één publieke `invalidateNa<Domein>Mutatie(qc)`-helper via z'n `cache.ts`. `modules/snijplanning/cache.ts` met `invalidateNaSnijplanMutatie` (snijplanning + snijvoorstel + rollen + productie-dashboard); nieuwe `modules/confectie/cache.ts` met `invalidateNaConfectieMutatie` (confectie + confectie-planning + confectie-werktijden). De 13 mutation-hooks in `use-snijplanning.ts` roepen voortaan `invalidateNaSnijplanMutatie(qc)` aan; status-mutaties + `useVoltooiSnijplanRol` + `useCreateSnijplan` + `useBatchUpdateSnijplanStatus` + `useUpdateSnijplanStatus` roepen óók `invalidateNaConfectieMutatie(qc)` aan. Confectie's `useAfrondConfectie` en de 3 scan-hooks idem op hun eigen helper. `useOpboekenItem` in `use-scanstation.ts` raakt zowel snijplanning als confectie. Verzamelt zo kandidaat #2 (querykeys-centralisatie) uit het 2026-05-11 architectuur-rapport — orthogonaal aan ADR-0012 Bundel-Zending dat de prefix-mismatch in `useVoltooiPickronde` één-regel-fixte.

- **Start/Afrond-knoppen op Confectielijst**: nieuwe `useStartConfectie` hook in `modules/confectie`; per rij op `/confectie` (Lijst-tab) een "Start"-knop (`Gesneden` → `In confectie` via `start_confectie`-RPC) en "Afronden"-knop (opent `AfrondModal` voor zowel `Gesneden` als `In confectie`). Operator kan vanuit deze lijst de volledige confectie-flow afhandelen tot Pick & Ship-overdracht zonder over te schakelen naar scanstation.

- **Bug-fix vandaag** (mig 246-tijdvak): `useVoltooiSnijplanRol` invalidate't nu óók `['confectie', 'planning-forward']` via de Confectie-helper. Na "Rol afsluiten" verschijnt een gesneden stuk meteen onder "Klaar voor confectie" — geen 30s staleTime-wacht meer.

- **Mig 246** `voltooi_snijplan_rol` TRUNCATE i.p.v. DELETE-zonder-WHERE (pg_safeupdate-21000-fix op temp-table `_reststuk_out`). Symptoom was "Rol afsluiten" → error 21000.

- **Mig 247** `voltooi_confectie` zet `p_ingepakt=true` voortaan status='Ingepakt' i.p.v. dead-end status='Gereed'. Reden: `confectie_planning_forward`-WHERE-clause kent geen 'Gereed', en `orderregel_pickbaarheid` (mig 170) filtert op `status='Ingepakt'`. De oude RPC liet stukken in 'Gereed'-purgatory: weg uit confectie-views, niet in Pick & Ship. Scanstation-pad (`opboekenItem` UPDATE → 'Ingepakt') blijft werken voor stukken die niet via de modal worden voltooid. AfrondModal-copy bijgewerkt naar "verschijnt direct in Pick & Ship (status Ingepakt)".

- **ESLint regressie-regel**: 7 nieuwe `no-restricted-imports`-entries voor `@/hooks/use-snijplanning`, `@/lib/supabase/queries/{snijplanning,snijplanning-mutations,snijvoorstel,auto-planning}`, `@/lib/utils/{compute-reststukken,snijplan-mapping}` + pattern voor `@/lib/snij-volgorde/*` — alle met ADR-0013-verwijzing.

- **Architectuur.md**: `modules/planning/`-belofte (regel 29) expliciet ingetrokken; Confectie-Module #9 en Snijplanning-Module #10 als zustermodules toegevoegd; slot-pattern-paragraaf bijgewerkt.

**Files**: nieuw `modules/snijplanning/{cache, index}.ts`, `queries/{snijplanning, snijplanning-mutations, snijvoorstel, auto-planning}.ts`, `hooks/use-snijplanning.ts`, `lib/{compute-reststukken, snijplan-mapping}.ts`, `lib/snij-volgorde/{derive, types}.ts`, `lib/snij-volgorde/__tests__/derive.test.ts`; nieuw `modules/confectie/cache.ts`; nieuw `docs/adr/0013-snijplanning-module-en-cache-invalidation-seam.md`; nieuwe `supabase/migrations/246_voltooi_snijplan_rol_truncate_temp.sql` + `247_voltooi_confectie_ingepakt_status.sql`. Geüpdatet `modules/confectie/index.ts`, `modules/confectie/hooks/{use-confectie, use-confectie-planning}.ts`, `hooks/use-scanstation.ts`, `components/confectie/afrond-modal.tsx`, `pages/confectie/confectie-overview.tsx`, `components/orders/order-form.tsx` (1-line import), `eslint.config.js`, `docs/architectuur.md`, en 11 callers in `components/{rollen, snijplanning}/` en `pages/snijplanning/`. Verwijderd 10 oude bestanden + lege folder `lib/snij-volgorde/`.

**Cross-cut behoud**: SQL-views (`snijplanning_overzicht`, `confectie_planning_forward`, `productie_dashboard`) ongewijzigd. RPC's `start_confectie`, `voltooi_confectie` (mig 247 hotfix), `voltooi_snijplan_rol` (mig 246 hotfix) blijven backend-eigendom. `productie_dashboard` blijft cross-cut tussen Snijplanning- en Confectie-Module — beide invalideren de key direct (kandidaat voor toekomstige `modules/productie/`-Module op de backlog).

**Verificatie**: `npx tsc --noEmit` schoon. `npx vitest run` — snij-volgorde tests 19/19 groen post-verhuizing.

## 2026-05-11 — ADR-0012: Bundel-Zending als deep Module + one-line query-key fix

Architectuur-rapport op 2026-05-11 (3 problemen gerapporteerd door operator op /logistiek):
1. Na voltooien pickronde duurt ~10 sec voor de zending zichtbaar is in /logistiek.
2. ZEND-2026-0010 (ORD-2026-2046, FLOORPASSION 3572AC Verhoek) en ZEND-2026-0006 (ORD-2026-2042 Verhoek-deel, zelfde klant/adres/week) zijn twee losse zendingen geworden waar het systeem onder [ADR-0010](adr/0010-factuur-volgt-bundel-zending.md) één bundel-zending had moeten vormen.
3. Twee facturen op 11-05-2026 (FACT-2026-0010 + FACT-2026-0011) voor wat één bundel-factuur had moeten zijn.

Diagnose via de `/improve-codebase-architecture`-skill: problemen 2+3 zijn één symptoom — de Bundel-Zending heeft geen Module-cohesie en geen entity-levenscyclus. Solo- en bundel-flow zitten in twee aparte RPC's met verschillende bundel-semantiek; UI-clustering gebeurt op 3D (in `bundel-cluster.ts`) bovenop een correcte SQL-view die op 4D groepeert. Probleem 1 is een orthogonale pure bug: prefix-mismatch in query-key-invalidation.

**ADR-0012** ([`docs/adr/0012-bundel-zending-als-deep-module.md`](adr/0012-bundel-zending-als-deep-module.md)) — accepted 2026-05-11. Beslissing: één RPC `start_pickronden(order_ids[], picker_id, force_solo_ids[])` (mig 248) vervangt `start_pickronden_voor_order` (mig 220) en `start_pickronden_bundel` (mig 222). 4D-uitbreiding default-on (auto-bundeling op `voorgestelde_zending_bundels`); `force_solo_ids` als opt-out-escape. Bundel-eenheid blijft order, `zending_orders` M2M blijft canoniek (mig 242 onveranderd) — geen nieuwe `zending_regels`-tabel. Pre-pickronde split via dialog-checkbox; tijdens-pick split blijft de bestaande niet-gevonden-flow op colli-niveau. Frontend: één `<StartPickrondesButton>` + `<StartPickrondesDialog>` vervangt `<BulkVerzendsetButton>` en `<VerzendsetButton>`; [`bundel-cluster.ts`](../frontend/src/modules/magazijn/lib/bundel-cluster.ts) (140 regels schaduw-clustering) wordt verwijderd.

**One-line fix** (deze commit, los van mig 248/249): [`use-pickronde.ts:64`](../frontend/src/modules/magazijn/hooks/use-pickronde.ts#L64) — `queryKey: ['zendingen']` → `['logistiek', 'zendingen']`. `useVoltooiPickronde` invalideerde de verkeerde prefix; React Query's prefix-match faalde stil zodat de /logistiek-lijst pas op de volgende 30s-poll-tick refreshde. Verlost de gerapporteerde 10s-lag direct, zonder migratie of UI-refactor.

**Woordenboek**: nieuwe term **Bundel-Zending** met 4D-sleutel-definitie en M2M-relatie tot `zending_orders`. Bestaande **Zending**-entry uitgebreid met verwijzing naar Bundel-Zending en de canonieke membership-bron.

**Implementatie van mig 248/249 + frontend-refactor**: volgt in deze commit (zie hieronder).

## 2026-05-11 — Fix: vorm-toeslag zichtbaar in order-bewerken (breakdown + dropdown)

Bij het aanmaken van een maatwerk-orderregel toonde de paarse maatwerk-strip twee dingen die in de bewerk-flow ontbraken:
1. De breakdown-zin rechts (`12,00 m² × € 34,99/m² + € 75,00 vorm + € … afwerking`).
2. De vorm-dropdown met `(+€ 75,00)`-suffix per vorm met een toeslag.

**Root causes:**
- (1) [`fetchOrderRegels`](../frontend/src/lib/supabase/queries/orders.ts) selecteerde alleen de "structuur"-velden (`maatwerk_vorm`, `maatwerk_lengte_cm`, `maatwerk_breedte_cm`, `maatwerk_afwerking`, …), niet de prijs-onderdelen (`maatwerk_m2_prijs`, `maatwerk_oppervlak_m2`, `maatwerk_vorm_toeslag`, `maatwerk_afwerking_prijs`, `maatwerk_diameter_cm`). Daardoor was `line.maatwerk_m2_prijs` `undefined` in de form-state en sloeg de guard `{line.maatwerk_m2_prijs != null && line.maatwerk_m2_prijs > 0 && …}` rond de breakdown-zin over.
- (2) [OrderLineEditor](../frontend/src/components/orders/order-line-editor.tsx) liet in de bewerk-flow alleen een statische fallback-lijst van 5 vorm-codes in de `<select>` zien (uit [`vorm-labels`](../frontend/src/lib/utils/vorm-labels.ts)) zonder DB-data. Daardoor verschenen Pebble/Ellips/Afgeronde Hoeken niet en miste élke optie de toeslag-suffix.

**Fix:**
- (1) Velden toegevoegd aan de `OrderRegel`-interface, de SELECT in `fetchOrderRegels`, de `toRegel`-mapping én de `regelData`-mapping in [order-edit.tsx](../frontend/src/pages/orders/order-edit.tsx). DB-kolommen bestonden al sinds mig 188/193.
- (2) [OrderLineEditor](../frontend/src/components/orders/order-line-editor.tsx) haalt nu `maatwerk_vormen` op via `fetchVormen` (cache `['maatwerk-vormen']`, staleTime 60s) en rendert de dropdown identiek aan [`VormAfmetingSelector`](../frontend/src/modules/maatwerk/components/vorm-afmeting-selector.tsx): `{v.naam}{v.toeslag > 0 ? ' (+€…)' : ''}`. De statische 5-codes blijven als fallback voor de eerste render vóór de query terugkomt.

**Verificatie:** open bestaande maatwerk-order → bewerken → paarse strip toont breakdown direct én vorm-dropdown toont "Ovaal (+€ 75,00)", "Pebble (+€ 75,00)", etc. — identiek aan de aanmaak-flow.

## 2026-05-11 — Hotfix mig 243: kwaliteit/kleur-fallback in `confectie_planning_forward`

Op /confectie toonde de kolom "Kwaliteit / Kleur" leeg voor sommige (vaak handmatig aangemaakte) maatwerk-orders, terwijl de orderregel duidelijk aan een product hangt met die info (bv. ORD-2026-2040: CISC 11 SANDRO via artikelnr 1771008). Andere orders met dezelfde kwaliteit (CISC 16 / CISC 24) toonden de code wél.

**Root cause:** [mig 104](../supabase/migrations/104_confectie_planning_afleverdatum_fallback.sql) selecteerde `kwaliteit_code`/`kleur_code` rechtstreeks uit `order_regels.maatwerk_kwaliteit_code` / `maatwerk_kleur_code`. Die snapshot-velden worden alleen gevuld via het maatwerk-pad in de webshop-matcher of de maatwerk-selector — bij handmatige order-aanmaak op een vast maatwerk-artikel blijven ze NULL. Resultaat: view-output leeg, ondanks dat zowel de rol als het product de juiste codes hebben.

**Fix:** [mig 243](../supabase/migrations/243_confectie_planning_kwaliteit_fallback.sql) — dezelfde COALESCE-chain als `snijplanning_overzicht` (mig 233):
1. `rollen.kwaliteit_code` / `kleur_code` (autoritatief zodra rol toegewezen)
2. `producten.kwaliteit_code` / `kleur_code` (via nieuwe `LEFT JOIN producten p ON p.artikelnr = orr.artikelnr`)
3. `order_regels.maatwerk_kwaliteit_code` / `maatwerk_kleur_code` (legacy/webshop-pad)

Geen frontend-wijziging nodig: [confectie-overview.tsx](../frontend/src/pages/confectie/confectie-overview.tsx) en [week-lijst.tsx](../frontend/src/components/confectie/week-lijst.tsx) lezen al `kwaliteit_code` + `kleur_code` uit de view.

**Verificatie:** /confectie → ORD-2026-2040 / ORD-2026-2041 tonen nu "CISC 11 SANDRO" in de kolom Kwaliteit / Kleur (consistent met ORD-2026-2045 / 2047).

## 2026-05-11 — Hotfix mig 242 + frontend: `zending_orders` canoniek (Pick & Ship bundel-zichtbaarheid)

Na mig 241 startte de bundel-pickronde technisch, maar in Pick & Ship toonde alleen de "primaire" order (de eerste van de bundel) "In pickronde · Test" — de overige bundel-leden verschenen als losse pickbare orders met een eigen "Verzendset"-knop. Daardoor leek de bundel mislukt te zijn terwijl de DB-state correct was.

**Root cause:** [fetchActievePickrondes](../frontend/src/modules/magazijn/queries/pickbaarheid.ts) query'de `zendingen.order_id` (de legacy/primaire-koppeling) en negeerde de `zending_orders` M2M-tabel. Bundel-zendingen zetten alleen de eerste order als `zending.order_id`; de overige leden zitten exclusief in M2M. Mig 222 r41-45 zei zelf al dat de M2M-tabel de *"authoritatieve bron voor de volledige order-set"* hoort te zijn, maar `start_pickronden_voor_order` (mig 220) en `create_zending_voor_order` (mig 206) schrijven géén M2M-rij voor solo-zendingen — dus consumers moesten beide bronnen UNION'en om correct te zijn.

**Fix:**
- [Mig 242](../supabase/migrations/242_zending_orders_canoniek.sql): AFTER-INSERT-trigger `trg_zending_set_m2m_a_ins` op `zendingen` schrijft automatisch een M2M-rij (ON CONFLICT DO NOTHING zodat de bundel-RPC die zelf al INSERT'eet niet conflicteert). Plus backfill van alle bestaande solo-zendingen.
- [pickbaarheid.ts](../frontend/src/modules/magazijn/queries/pickbaarheid.ts) `fetchActievePickrondes` query't nu `zending_orders` met PostgREST INNER-embed op `zendingen!inner(...)` gefilterd op `status='Picken'` — één bron, geen fallback.

**Effect:** alle bundel-leden tonen nu correct "In pickronde · Test" zodra de bundel start. `zending_orders` is vanaf mig 242 de canonieke bron voor "alle orders van een zending"-queries; de UNION-fallback in `voltooi_pickronde` (mig 222 r310-315) blijft staan als defensieve klep maar wordt in praktijk niet meer getriggerd.

**Verificatie:** Pick & Ship → hard refresh → beide orders in een bundel tonen "In pickronde", géén losse "Verzendset"-knop meer voor de niet-primaire bundel-leden.

## 2026-05-11 — Hotfix mig 241: RLS-policy op `zending_orders` (Pick & Ship bundel)

Bundel-pickronde over ≥2 orders crashte met `42501: new row violates row-level security policy for table "zending_orders"` in [start_pickronden_bundel](../supabase/migrations/222_zending_bundeling_op_adres.sql) (zichtbaar in `BulkVerzendsetButton`-popover als "Bulk-aanmaken mislukt"). Solo-pad ([start_pickronden_voor_order](../supabase/migrations/220_start_pickronden_per_vervoerder.sql)) bleef werken omdat dat de M2M-tabel niet raakt.

**Root cause:** mig 222 maakte `zending_orders` aan zonder het RLS-pattern uit mig 169 (`zendingen`/`zending_regels` → ENABLE + all-authenticated policy) door te trekken. Op de live DB werd RLS via Supabase-Studio-advisor alsnog aangezet, maar zonder INSERT-policy voor `authenticated` — en de RPC is `SECURITY INVOKER`. De DEFINER-keuze in mig 222 r357 voor `voltooi_pickronde` is bewust gemaakt voor `order_events` (restrictieve audit-log) en hoort hier niet bij; `zending_orders` is qua karakter een gewone M2M-koppeltabel.

**Fix:** [mig 241](../supabase/migrations/241_zending_orders_rls_policy.sql) — idempotente `ENABLE RLS` + `CREATE POLICY zending_orders_all FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE)` met `DROP IF EXISTS`-guard. Geen RPC-wijziging, geen frontend-wijziging.

**Verificatie:** Pick & Ship → 2 orders zelfde adres + week + vervoerder → "Start bundel" → succes, ≥2 rijen in `zending_orders`.

## 2026-05-08 — ADR-0011 uitgevoerd: Debiteur-Module compleet (stappen 1/8 t/m 8/8)

Volledige uitvoering van het 8-staps migratiepad uit [ADR-0011](adr/0011-debiteur-als-deep-module.md), in één PR conform user-feedback dat ADR's niet mogen stapelen zonder implementatie:

- **Stap 1/8 — folder + lege barrel**: `frontend/src/modules/debiteuren/index.ts` aangemaakt.
- **Stap 2/8 — `<KlantBenaming/>` slot-component**: nieuwe component in `modules/debiteuren/components/klant-benaming.tsx` + `hooks/use-klant-benaming.ts` die `resolve_klanteigen_naam`-RPC self-fetcht via React Query. 4-prop interface (`debiteurNr`, `kwaliteit`, `kleur`, `fallback`); geen TS-spiegel van de 5-niveaus fallback-logica.
- **Stap 3/8 — queries + hooks verhuizen**: `lib/supabase/queries/klanten.ts` (389 regels) gesplitst in `modules/debiteuren/queries/{debiteuren.ts, klant-artikelnummers.ts, debiteur-prijslijst.ts}`. `klanteigen-namen.ts` (231 regels) verhuisd naar `modules/debiteuren/queries/`. Hooks `use-klanten.ts` + `use-klanteigen-namen.ts` verhuisd. **Bug-fixes meegenomen**: `useVertegenwoordigers` verhuisd uit `use-klanten.ts` naar `use-medewerkers.ts` (post-ADR-0004 hoort daar) als Medewerker-rol-wrapper; `fetchKleurenVoorKwaliteit` + `useKleurenVoorKwaliteit` verhuisd naar `producten.ts` + `use-producten.ts` (catalogus-data, geen klant-data).
- **Stap 4/8 — pages + components + rename**: 9 components verhuisd uit `components/klanten/` naar `modules/debiteuren/components/`; 2 pages uit `pages/klanten/` naar `modules/debiteuren/pages/` met DB-aligned bestandsnamen (`debiteur-detail.tsx`, `debiteuren-overview.tsx`). Types `KlantRow` → `DebiteurRow`, `KlantDetail` → `DebiteurDetail`. Hooks `useKlanten` → `useDebiteuren`, `useKlantDetail` → `useDebiteurDetail`. Component `KlantCard` → `DebiteurCard`, `KlantEditDialog` → `DebiteurEditDialog`. Routes blijven `/klanten/...`, UI-tekst blijft "Klant". Externe callers in `prijslijst-detail.tsx`, `prijslijst-add-klant-dialog.tsx`, `inkoopgroep-eigen-namen-tab.tsx`, `order-form.tsx`, `orders.ts` updated naar `@/modules/debiteuren`-barrel.
- **Stap 5/8 — `<KlantBenaming/>`-adoptie**: orders/facturatie/magazijn gebruiken al een efficiëntere batched `fetchKlanteigenNamenMap`-pattern in hun fetchers (één SQL-RPC voor N regels) — geen forced adoptie. Slot-component blijft beschikbaar via barrel als toekomstige affordance voor solo-display-callers.
- **Stap 6/8 — afleveradressen-tab uitsplitsen**: lokale `AdressenTab`-function uit 669-regel `klant-detail.tsx` geëxtracteerd naar eigen file `modules/debiteuren/components/afleveradressen-tab.tsx`. Type gepromoveerd van inline-shape naar geëxporteerde `Afleveradres`.
- **Stap 7/8 — oude paden verwijderen + ESLint**: 15 oude bestanden verwijderd (9 components, 2 pages, 2 hooks, 2 queries) + folders `components/klanten/` en `pages/klanten/` opgeruimd. ESLint `no-restricted-imports`-regel toegevoegd voor `@/lib/supabase/queries/klanten`, `@/lib/supabase/queries/klanteigen-namen`, `@/hooks/use-klanten`, `@/hooks/use-klanteigen-namen`, `@/components/klanten/*`-pattern, `@/pages/klanten/*`-pattern — alles met ADR-0011-verwijzing in de error-message en gerichte tip voor `useVertegenwoordigers`/`useKleurenVoorKwaliteit`.
- **Stap 8/8 — typecheck + docs**: `npm run typecheck` schoon. `npx eslint src/modules/debiteuren` schoon (één pre-existing lint-error in gekopieerde `klanteigen-naam-dialog.tsx` — niet door deze sweep geïntroduceerd).

**Cross-cuts behouden**: SQL-RPC `resolve_klanteigen_naam` blijft single source of truth voor benaming-resolutie; backend-callers (factuur-RPC, EDI-builder, pakbon-edge) consumeren direct, zonder Module-coupling. Tier-berekening blijft SQL-cron, exposeert tier-veld via `DebiteurRow`. Adres-snapshot-helper out-of-scope (komt mee met ADR-0001 Orders-Module).

**Files**: nieuw `modules/debiteuren/{index.ts, components/{klant-benaming, debiteur-card, debiteur-edit-dialog, klant-prijslijst-tab, klant-prijslijst-selector, klant-verteg-selector, klanteigen-namen-tab, klanteigen-naam-dialog, klant-artikelnummers-tab, klant-facturering-tab, afleveradressen-tab}.tsx, hooks/{use-klant-benaming, use-debiteuren, use-klanteigen-namen}.ts, queries/{debiteuren, klant-artikelnummers, debiteur-prijslijst, klanteigen-namen}.ts, pages/{debiteuren-overview, debiteur-detail}.tsx}`. Aangepast `router.tsx`, `eslint.config.js`, `lib/supabase/queries/{producten, orders}.ts`, `hooks/{use-producten, use-medewerkers}.ts`, `components/{prijslijsten/prijslijst-add-klant-dialog, inkoopgroepen/inkoopgroep-eigen-namen-tab, orders/order-form}.tsx`, `pages/prijslijsten/prijslijst-detail.tsx`. Verwijderd 15 oude bestanden.

## 2026-05-08 — Confectie als negende deep verticale Module (smal scope)

Architectuur-skill `/improve-codebase-architecture` losgelaten op de "Confectie"-shallow-plek. Confectie had alle ingrediënten voor een Module — eigen status-flow, eigen lane-concept (per `type_bewerking`), eigen capaciteit-/deadline-formules, eigen RPC's `start_confectie`/`voltooi_confectie` — maar leefde verspreid over `lib/utils/`, `lib/supabase/queries/`, `hooks/`, `components/confectie/` en `pages/confectie/` zonder Module-eigenaar.

Grilling-sessie koos **smal scope** (alleen logica-laag), **geen aparte ADR** (referentie naar ADR-0009-precedent volstaat) en **slot-import via barrel** voor cross-Module-consumers. Resultaat:

- Nieuw: `frontend/src/modules/confectie/` met `lib/`, `queries/`, `hooks/`, barrel `index.ts`.
- Verhuisd: `lib/utils/confectie-deadline.ts` → `modules/confectie/lib/deadline.ts`; `lib/utils/confectie-forward-planner.ts` → `modules/confectie/lib/forward-planner.ts`; drie query-files (`confectie.ts`, `confectie-planning.ts`, `confectie-mutations.ts`) van `lib/supabase/queries/` → `modules/confectie/queries/`; twee hook-files (`use-confectie.ts`, `use-confectie-planning.ts`) van `hooks/` → `modules/confectie/hooks/`. Test-bestand mee verhuisd (5 tests groen).
- Pages en components blijven fysiek waar ze waren maar consumeren de Module nu via `@/modules/confectie`-barrel — 7 callers geüpdatet (pages/confectie/* en alle 5 componenten in components/confectie/*).
- De Module exporteert **geen React-componenten** om import-cycles te vermijden. `<ConfectieTijdenConfig>` blijft direct geïmporteerd door `pages/instellingen/productie-instellingen.tsx`.

Geen schema-wijzigingen, geen edge-function-wijzigingen, geen route-wijzigingen. Type-check schoon, 5 confectie-tests groen.

**Files**: nieuw `modules/confectie/{lib/{deadline.ts, forward-planner.ts, __tests__/forward-planner.test.ts}, queries/{confectie.ts, confectie-planning.ts, confectie-mutations.ts}, hooks/{use-confectie.ts, use-confectie-planning.ts}, index.ts}`. Geüpdatet: `data-woordenboek.md` (Confectie-Module-term), `architectuur.md` (Module-graf-paragraaf — negende Module).

## 2026-05-08 — Drie shallow queries verhuisd naar SQL (mig 237-239)

Architectuur-skill `/improve-codebase-architecture` op `frontend/src/lib/supabase/queries/` losgelaten. Drie functies maakten relationele orchestratie of aggregatie client-side die in SQL hoort — zelfde patroon als mig 236 (`claims_voor_product`).

- **Mig 237 `confectie_status_counts()`** — vervangt [`fetchConfectieStatusCounts`](../frontend/src/lib/supabase/queries/confectie.ts) dat alle rijen uit `confectie_overzicht` naar de browser sleepte puur om in JS een `Map` te bouwen voor `COUNT(*) GROUP BY status`. Volgt het bestaande `snijplanning_status_counts_gefilterd`-patroon zodat tab-tellers één shape hebben.
- **Mig 238 `snijplanning_kpis_gefilterd(p_tot_datum)`** — vervangt drie parallelle `count: 'exact', head: true`-queries in [`fetchSnijplanningKpis`](../frontend/src/lib/supabase/queries/snijplanning.ts). De ISO-week-grenzen (`weekRange()`-helper in JS) zijn weg; Postgres `date_trunc('week', …)` is nu de single source. 3 round-trips → 1, en de pattern-drift met de buurman `*_status_counts_gefilterd` is opgelost.
- **Mig 239 `handmatige_keuzes_voor_order(p_order_id)`** — vervangt drie sequentiële queries in [`fetchHandmatigeKeuzesVoorOrder`](../frontend/src/lib/supabase/queries/reserveringen.ts) (order_regels → order_reserveringen → producten). Filter `is_handmatig=true AND status='actief'` leeft nu uitsluitend in SQL ipv mengeling van `.eq()`-clauses + JS `.filter()`. Spiegelt mig 236 één-op-één.

Geen schema-wijzigingen; alle drie de RPCs zijn `STABLE` en read-only. Type-check + 194 tests groen.

**Files**: [`237_confectie_status_counts_rpc.sql`](../supabase/migrations/237_confectie_status_counts_rpc.sql), [`238_snijplanning_kpis_gefilterd_rpc.sql`](../supabase/migrations/238_snijplanning_kpis_gefilterd_rpc.sql), [`239_handmatige_keuzes_voor_order_rpc.sql`](../supabase/migrations/239_handmatige_keuzes_voor_order_rpc.sql), aangepast [`confectie.ts`](../frontend/src/lib/supabase/queries/confectie.ts), [`snijplanning.ts`](../frontend/src/lib/supabase/queries/snijplanning.ts), [`reserveringen.ts`](../frontend/src/lib/supabase/queries/reserveringen.ts).

## 2026-05-08 — ADR-0011 aangenomen: Debiteur als achtste deep verticale Module

Architectuur-skill `/improve-codebase-architecture` op de "Debiteur"-shallow-plek. Klant-detail-pagina mengt 8 tabs (masterdata, adressen, orders, facturering, klanteigen namen, artikelnummers, prijslijst, EDI) zonder Module-eigenaar; vier andere Modules (Facturatie ADR-0007, Vervoerder-keuze ADR-0008, EDI, Orders ADR-0001) consumeren klant-velden zonder duidelijke seam.

[ADR-0011](adr/0011-debiteur-als-deep-module.md) introduceert `modules/debiteuren/` als achtste domein-Module na Maatwerk (ADR-0009). Vier ankers in grilling-sessie:

- **Naam strikt DB-aligned**: folder `modules/debiteuren/`, types `DebiteurRow`/`DebiteurDetail`, hooks `useDebiteur*`, page-bestanden `debiteur-detail.tsx`. Routes blijven `/klanten/...`, UI-tekst blijft "Klant" — alleen code- en docs-discipline. Volgt ADR-0009-pattern (Maatwerk Anker 1).
- **Scope medium**: Module bezit masterdata + afleveradressen + klanteigen-namen-admin (CRUD) + klant-artikelnummers-admin. Slot-tabs voor Orders/Facturering/Prijslijst/EDI komen uit hun eigen Modules (of, voor Orders en Prijslijst, via tussentijdse directe imports).
- **Twee seam-stijlen**: hooks-import voor host-pagina + admin-mutations; **slot-component `<KlantBenaming/>`** voor cross-Module display in orders/facturatie/magazijn (4-prop interface, self-fetcht via `resolve_klanteigen_naam`-RPC). Backend-callers (factuur-RPC, EDI-builder, pakbon-edge) consumeren dezelfde SQL-RPC direct — twee adapters maken het een echt seam, geen TS-spiegel van de 5-niveaus fallback.
- **Slot-deps op niet-bestaande Modules**: tussentijdse directe imports voor Orders-tab en Prijslijst-tab; ADR markeert expliciet als technisch krediet dat verhuist zodra ADR-0001 uitgevoerd is / Prijslijst-Module ontstaat. Voorkomt blokkade op Orders-Module-uitvoering (vereist 20-cases regression-baseline).

Bug-fixes meegenomen in migratiepad: `useVertegenwoordigers` verhuist uit `use-klanten.ts` naar `use-medewerkers.ts` (post-ADR-0004 hoort daar); `useKleurenVoorKwaliteit` verhuist naar Producten-hooks. Cross-cuts buiten scope: tier-berekening (SQL-cron), adres-snapshot-helper (komt mee met Orders-Module), inkoopgroep-modus van klanteigen-namen-tab (V2-uitbreiding via `inkoopgroepCode`-prop).

Migratiepad in 8 incrementele stappen (chore folder + lege barrel → feat `<KlantBenaming/>` → refactor queries/hooks/pages → adoptie in andere Modules → splitsen afleveradressen-tab → cleanup → docs). Geen DB-migratie. Eerste vervolg-ADRs op de backlog: Producten-Module (#2 uit ADR-0009-backlog), Orders-Module-uitvoering (ADR-0001), Prijslijst-Module, Medewerkers-Module.

[`data-woordenboek.md`](data-woordenboek.md) krijgt term *Debiteur-Module*; [`architectuur.md`](architectuur.md) Module-graf-paragraaf aangevuld + slot-pattern-sectie krijgt `<KlantBenaming/>`-voorbeeld.

## 2026-05-08 — Pick & Ship bundel-cluster volgt nu écht de 4D bundel-sleutel

Op de Pick & Ship-overview groepeerde [`clusterOrdersOpKlant`](../frontend/src/modules/magazijn/lib/groeperen.ts) orders puur op `debiteur_nr`, terwijl de bundel-definitie (mig 229) 4-dimensionaal is — `(debiteur × adres × effectieve vervoerder × verzendweek)`. Gevolg: twee FLOORPASSION-orders met verschillende vervoerders (Verhoek + HST) verschenen onder één "BUNDEL FLOORPASSION 2 orders"-header, wat suggereerde dat ze één gezamenlijke verzending zouden vormen — terwijl de backend correct twee aparte zendingen + twee verzendkosten-regels (mig 232) had aangemaakt.

Fix is puur frontend-clustering: `clusterOrdersOpKlant` (en transitief `groepeerOrdersOpLand`) accepteren nu een `bundelSleutelByOrderId`-map en clusteren op de bundel-sleutel uit `voorgestelde_zending_bundels`. Orders zonder bundel-entry (geen afleverdatum, actieve zending) krijgen elk een eigen solo-cluster, dus de klant-grouping als zodanig vervalt — sortering blijft op `(klant_naam, order_nr)` zodat dezelfde-klant-clusters visueel naast elkaar blijven staan. Pick-week-sectie bouwt nu naast `bundelByOrderId` (lookup voor decoratie) ook `sleutelByOrderId` (drijft de clustering).

Daarnaast is de **drempel-progressbar** uit [`VoorgesteldeBundelInfo`](../frontend/src/modules/magazijn/components/voorgestelde-bundel-info.tsx) verwijderd: die toonde "€ 347 van € 500 — nog € 153 tot gratis" boven elke bundel, wat factuur-/commerciële informatie is die voor order-pickers irrelevant is. De truck-icoon + adres-snippet + besparing-badge blijven staan zodat de bundel als bundel herkenbaar is.

Tests in [`groeperen.test.ts`](../frontend/src/modules/magazijn/lib/__tests__/groeperen.test.ts) bijgewerkt: nieuwe scenario's bewijzen dat zelfde-klant-orders met verschillende bundel-sleutels in losse clusters belanden, en dat orders zonder bundel-entry een solo-cluster krijgen zonder andere bundels te besmetten.

**Files**: aangepast [`groeperen.ts`](../frontend/src/modules/magazijn/lib/groeperen.ts), [`pick-week-sectie.tsx`](../frontend/src/modules/magazijn/components/pick-week-sectie.tsx), [`voorgestelde-bundel-info.tsx`](../frontend/src/modules/magazijn/components/voorgestelde-bundel-info.tsx), [`groeperen.test.ts`](../frontend/src/modules/magazijn/lib/__tests__/groeperen.test.ts).

## 2026-05-08 — Drie kleine deepening-ingrepen (Klanteigen-namen, claims_voor_product, order-form-extracts)

Architectuur-skill `/improve-codebase-architecture` op vier shallow plekken na ADR-0009/0010. Drie eenvoudige refactors zonder ADR-niveau-discussie of Module-folder-werk; mechanische concentratie van verspreide kennis.

**1. Klanteigen-namen-resolver geconcentreerd in [`klanteigen-namen.ts`](../frontend/src/lib/supabase/queries/klanteigen-namen.ts).** De domeinvraag *"wat heet dit voor deze klant"* leefde voor de helft in [`order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts) (RPC `resolve_klanteigen_naam`, singular) en voor de helft als ad-hoc `supabase.rpc()`-call in [`orders.ts`](../frontend/src/lib/supabase/queries/orders.ts) (batch). Daarnaast was er een **dode parallelle "domme"-variant**: `fetchKlanteigenNamen` + `useKlanteigenNamen` + `KlanteigenNaam`-interface in [`klanten.ts`](../frontend/src/lib/supabase/queries/klanten.ts) / [`use-klanten.ts`](../frontend/src/hooks/use-klanten.ts) die geen inheritance kende en die geen enkele caller meer had sinds de tab op `useKlanteigenVoorKlant` overstapte. Beide RPC-paden verhuisd naar `klanteigen-namen.ts` (`fetchKlanteigenNaam` singular, `fetchKlanteigenNamenMap` batch); `orders.ts:fetchOrderRegels` consumeert de Map; dode code geschrapt.

**2. [`fetchClaimsVoorProduct`](../frontend/src/lib/supabase/queries/producten.ts) van 80 regels JS-orchestratie naar SQL-RPC.** De client-side 4-stap (orderregels → claims → orders → debiteuren met `Map`/`.find()`) had een eslint-disable-rij voor `any`-types en een hardcoded `['Verzonden', 'Geannuleerd']`-filter buiten de DB. Nieuwe RPC `claims_voor_product(p_artikelnr)` doet de relationele JOIN inclusief omsticker-pad (`reg.artikelnr = p_artikelnr OR reg.fysiek_artikelnr = p_artikelnr`) en de status-filter in één query. TS-functie wordt thin wrapper (4 regels). **Niet in deze commit:** mig 236 toegevoegd maar moet handmatig worden toegepast (Karpi MCP heeft geen toegang).

**3. Order-form pure functies naar [`lib/orders/`](../frontend/src/lib/orders/).** Twee blokken in [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) (regel-filtering + drempel-toets voor verzend-regel; client+config-fallback voor afleverdatum) waren pure-functie-kandidaten die geen state of effects nodig hadden. Geëxtraheerd naar [`lib/orders/verzend-regel.ts`](../frontend/src/lib/orders/verzend-regel.ts) (`applyShippingLogic`, met smal `KlantVerzendInfo`-contract) en [`lib/orders/order-afleverdatum.ts`](../frontend/src/lib/orders/order-afleverdatum.ts) (`bepaalOrderAfleverdatum`, wrapper boven `lib/utils/afleverdatum.ts`). Order-form importeert uit barrel-stijl naast de bestaande [`verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts) en [`bundel-sleutel.ts`](../frontend/src/lib/orders/bundel-sleutel.ts). De default-arg-closure (`afhalenActief: boolean = afhalen`) is opgelost door `afhalen` op alle 3 callsites expliciet door te geven. Zet de toon voor de V2-row-splitsing die ADR-0009 op de backlog zette — deze extracts bewijzen dat pure-state derivaties uit het 939-regel-bestand kunnen zonder de form-flow te raken.

**Files**: nieuwe [`mig 236`](../supabase/migrations/236_claims_voor_product_rpc.sql), [`lib/orders/verzend-regel.ts`](../frontend/src/lib/orders/verzend-regel.ts), [`lib/orders/order-afleverdatum.ts`](../frontend/src/lib/orders/order-afleverdatum.ts); aangepast [`klanteigen-namen.ts`](../frontend/src/lib/supabase/queries/klanteigen-namen.ts), [`order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts), [`orders.ts`](../frontend/src/lib/supabase/queries/orders.ts), [`klanten.ts`](../frontend/src/lib/supabase/queries/klanten.ts), [`use-klanten.ts`](../frontend/src/hooks/use-klanten.ts), [`producten.ts`](../frontend/src/lib/supabase/queries/producten.ts), [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx).

**Geen ADR**: alle drie binnen bestaande Module-grenzen, geen seam-verandering, geen domein-vocab-uitbreiding.

## 2026-05-08 — ADR-0010 aangenomen: factuur volgt bundel-zending; `factuurvoorkeur='per_zending'` vervalt

Tijdens een grilling-sessie over een geplande Zending-lifecycle Module bleek dat de "per-zending-facturatie" open-kandidaat (genoemd in ADR-0005, ADR-0006 én ADR-0007) **fundamenteel tegenstrijdig** is met Karpi's bundel-drempel-strategie: bij €300 op maandag + €300 op vrijdag van dezelfde klant zou per-zending-facturatie de klant 2× verzendkosten kosten, terwijl bij bundeling het totaal van €600 boven de €500-drempel uitkomt en verzending €0 wordt.

[ADR-0010](adr/0010-factuur-volgt-bundel-zending.md) sluit deze open-kandidaat dicht en herziet de aggregatie-eenheid voor facturatie:

- **Factuur volgt bundel-zending.** Aggregatie volgt de 4-dim bundel-sleutel uit mig 228 — `(debiteur × adres × vervoerder × verzendweek)`. Een klant met 2 verschillende afleveradressen of 2 verschillende vervoerders in dezelfde week krijgt N facturen, één per pakbon.
- **`factuurvoorkeur` gedropt** (mig 234 te schrijven). Kolom op `debiteuren`, mig 118-trigger en de UI-radio in klant-detail vervallen.
- **Mig 232 herzien** (mig 235 te schrijven). `genereer_factuur_voor_week(debiteur, week)` wordt vervangen door `genereer_factuur_voor_bundel(zending_id)`. Aggregatie-eenheid is voortaan de bundel-zending, niet de week.
- **Verzendkosten-resolver geconcentreerd.** Nieuwe SQL-functie `verzendkosten_voor_bundel(deb, subtotaal, is_afhalen)` returnt `(te_betalen, status, reden)` — bron-van-waarheid voor de 4-paden-toets (afhalen / klant-gratis / drempel-gehaald / normaal). View 229 en de nieuwe factuur-RPC consumeren beide deze functie.

ADR-0005, ADR-0006 en ADR-0007 zijn bijgewerkt: hun open-kandidaten over per-zending-facturatie verwijzen nu naar ADR-0010 als sluitsteen. Data-woordenboek + architectuur.md "Facturatie-flow"-sectie aangepast.

**Numbering note**: ADR-eerst geconcipieerd als 0009; tijdens dezelfde dag landde ADR-0009 (Maatwerk-Module) op `main`, dus hernummerd naar 0010.

**Wat is in deze commit (docs-only):**
- [`docs/adr/0010-factuur-volgt-bundel-zending.md`](adr/0010-factuur-volgt-bundel-zending.md) — nieuwe ADR.
- [`docs/adr/0005-pickronde-sluit-de-factuur-keten.md`](adr/0005-pickronde-sluit-de-factuur-keten.md), [`0006`](adr/0006-order-lifecycle-als-deep-module.md), [`0007`](adr/0007-facturatie-als-deep-module.md) — open-kandidaten dichtgezet.
- [`docs/data-woordenboek.md`](data-woordenboek.md) — nieuwe term **Bundel-factuur**, nieuwe term **Verzendkosten-resolver**, **factuurvoorkeur** gemarkeerd als vervallen, **Facturatie-Module** + **factuur_queue**-beschrijving aangescherpt.
- [`docs/architectuur.md`](architectuur.md) — "Facturatie-flow"-sectie herschreven naar bundel-driven flow met wekelijkse cron als enige enqueue-bron.

**Niet in deze commit (vervolg-implementatie):** mig 234 (drop trigger + factuurvoorkeur-kolom), mig 235 (`genereer_factuur_voor_bundel` + `verzendkosten_voor_bundel`), `enqueue_wekelijkse_verzamelfacturen` herschrijven, frontend `klant-facturering-tab.tsx` opruim. Volgt in een aparte branch.

## 2026-05-08 — Snij-marge: SQL-only seam, TS-spiegels weg (mig 233)

Architectuur-deepening (skill `/improve-codebase-architecture`). De Snij-marge had drie implementaties: SQL `stuk_snij_marge_cm()` (mig 126), edge-shared [`_shared/snij-marges.ts`](../supabase/functions/_shared/snij-marges.ts) en frontend [`lib/utils/snij-marges.ts`](../frontend/src/lib/utils/snij-marges.ts). Code-comments waarschuwden voor "houd synchroon met de andere kant" zonder vangnet — een sync-divergentie zou stilletjes verkeerd-gesneden tapijten produceren. Bovendien bleek de FE-kopie **dode code**: geen enkele caller in `frontend/` importeerde nog uit `lib/utils/snij-marges.ts`. De hele frontend kreeg `marge_cm` al uit view-kolom (mig 143). De edge-kopie werd alleen door [`_shared/db-helpers.fetchStukken`](../supabase/functions/_shared/db-helpers.ts) inline op N stukken aangeroepen.

**Eindstaat — één bron, twee gerichte view-kolommen**:

- [`mig 233`](../supabase/migrations/233_snijplanning_overzicht_placed_kolommen.sql) breidt view `snijplanning_overzicht` uit met `placed_lengte_cm` + `placed_breedte_cm` (snij-maat na marge-ophoging). `marge_cm` (mig 143) blijft voor operator-tekst in [`rol-uitvoer-modal.tsx`](../frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) en [`derive.ts`](../frontend/src/lib/snij-volgorde/derive.ts). Twee verschillende interface-concepten — operator vs. packer — twee kolommen.
- `fetchStukken` leest de placed-kolommen direct, geen TS-helper-import meer.
- `_shared/snij-marges.ts` + `_shared/snij-marges.test.ts` + `frontend/src/lib/utils/snij-marges.ts` verwijderd.
- Regressie-vangnet: `DO $$ ASSERT $$`-blok in mig 233 dekt alle scenario-categorieën uit de oude Deno-test (NULL/empty, ZO, rond/ovaal case-insensitive, combi grootste-wint, niet-marge-afwerkingen B/FE/LO/ON/SB/SF/VO).

**Files**: nieuwe [`mig 233`](../supabase/migrations/233_snijplanning_overzicht_placed_kolommen.sql); aangepast [`_shared/db-helpers.ts`](../supabase/functions/_shared/db-helpers.ts), [`docs/architectuur.md`](architectuur.md) (Snij-marges-sectie + cross-cut-entry), [`docs/data-woordenboek.md`](data-woordenboek.md) (Snij-marge-entry), [`docs/database-schema.md`](database-schema.md) (`stuk_snij_marge_cm`-entry), [`docs/adr/0009-maatwerk-als-deep-module.md`](adr/0009-maatwerk-als-deep-module.md) (drie cross-cut-claims). Verwijderd: drie TS-bestanden + Deno-test.

**Niet aangeraakt**: SQL-functie `stuk_snij_marge_cm()` zelf (mig 126) blijft ongewijzigd — alleen z'n COMMENT verwijst niet meer naar TS-spiegels. `snijplanning_tekort_analyse` (mig 134) gebruikt de SQL-functie nog steeds inline.

## 2026-05-08 — Maatwerk-Module — ADR-0009 + uitvoering

Architectuur-review (2026-05-08) wees Maatwerk aan als #1 deepening-kandidaat: 39 exports verspreid over [`lib/supabase/queries/op-maat.ts`](../frontend/src/lib/supabase/queries/op-maat.ts) (761 regels) + 40 maatwerk-touchpoints in [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) (939 regels) + [`kwaliteit-first-selector.tsx`](../frontend/src/components/orders/kwaliteit-first-selector.tsx) (783 regels) + losse utils en admin-pages. Geen Module-eigenaar voor een prominent domein-concept.

Grilling-loop op 2026-05-08 leverde drie ankers:

1. **Naam: Maatwerk** — DB-aligned met `is_maatwerk` / `maatwerk_*`-kolommen, niet de UI-toggle "Op Maat".
2. **Scope: medium** — Module bezit runtime-flow én admin-CRUD voor vormen, afwerkingen, m²-prijzen, band-kleur-defaults. Snij-marge (`_shared/snij-marges.ts` + mig 126) blijft cross-cut; gewicht-resolver (mig 184-186) blijft eigen SQL-Module.
3. **Seam: hooks-import** — order-form blijft host; alle data + formules via barrel `@/modules/maatwerk` (geen slot-pattern, geen row-splitsing). Vergelijk Facturatie-Module (ADR-0007) waar `klant-facturering-tab.tsx` ook host bleef.

Deze entry is alleen documenten-werk: nieuwe [`docs/adr/0009-maatwerk-als-deep-module.md`](adr/0009-maatwerk-als-deep-module.md), nieuwe sectie `## Maatwerk` in [`data-woordenboek.md`](data-woordenboek.md), sectie "Op Maat Module" in [`architectuur.md`](architectuur.md) hernoemd naar "Maatwerk-Module" en uitgebreid met seam-beschrijving + cross-cut-grenzen, en de Module-graf-paragraaf vermeldt nu zeven domein-modules. Code-verhuizing (~12 files, splitsing van `op-maat.ts`, route-redirect voor admin-pages) volgt in een aparte PR.

**Uitvoering 2026-05-08 (commits via 10 incremental refactor-stappen):**

- Module-folder `frontend/src/modules/maatwerk/` opgebouwd met:
  - `lib/{oppervlak,prijs,leverdatum}.ts` — pure formules (geen DB)
  - `queries/{maatwerk-runtime,maatwerk-instellingen}.ts` — split van 761-regels-`op-maat.ts` op concern (20 reads + 9 types in runtime, 10 admin-mutations in instellingen)
  - `components/` — 9 verhuisde components (5 runtime + 4 admin); `OpMaatSelector` hernoemd naar `MaatwerkSelector`
  - `hooks/use-maatwerk-instellingen.ts` — gecombineerde admin-hooks (was `use-vormen.ts` + `use-afwerkingen.ts`)
  - `pages/{vormen,afwerkingen}-instellingen.tsx`
  - `index.ts` — barrel met alle publieke API
- 17 oude files verwijderd; 6 consumer-files (order-form, order-line-editor, 3 producten-pages, router) overgezet naar `@/modules/maatwerk`
- ESLint-regressie-regel `no-restricted-imports` voor 3 oude paden toegevoegd in `eslint.config.js`
- Tests verhuisd naar `modules/maatwerk/queries/__tests__/maatwerk-runtime.test.ts`; vitest run = 194 tests groen

## 2026-05-08 — Dynamische zending-bundeling met wekelijkse verzamelfactuur (mig 228-232)

Karpi-eis: orders die naar dezelfde klant in dezelfde week gaan automatisch bundelen → 1 zending → 1× transportbeweging → 1× verzendkosten. Wanneer het bundel-totaal de klant-drempel overschrijdt (`debiteuren.verzend_drempel`, default €500) verdwijnt de verzendkosten zelfs helemaal. Daarnaast: 1 wekelijkse verzamelfactuur per debiteur waarop alle bundel-zendingen samen verschijnen — `factuurvoorkeur='wekelijks'` (mig 117) was sinds vorig jaar een no-op en wordt nu eindelijk operationeel.

**Architectuur — 5 lagen, expliciete seams**:

1. **Bundel-sleutel** ([`mig 228`](../supabase/migrations/228_bundel_sleutel_helper.sql), [`bundel-sleutel.ts`](../frontend/src/lib/orders/bundel-sleutel.ts), [`normaliseer-adres.ts`](../frontend/src/lib/orders/normaliseer-adres.ts)) — pure SQL-functie `bundel_sleutel(debiteur_nr, adres_norm, vervoerder, jaar_week)` + TS-spiegel. Wijzigt één van de 4 dimensies → andere sleutel → orders splitsen automatisch. Mig 228 voegt ook `verzendweek_voor_datum(date)` toe en herstelt de ontbrekende `debiteuren.gratis_verzending`-kolom (frontend kende hem al; mig 201 had hem overgeslagen).

2. **Voorgestelde-bundel** ([`mig 229`](../supabase/migrations/229_voorgestelde_zending_bundels_view.sql), [`voorgestelde-bundels.ts`](../frontend/src/modules/logistiek/queries/voorgestelde-bundels.ts)) — pure SQL-view `voorgestelde_zending_bundels` die open orders × `effectieve_vervoerder_per_orderregel` aggregeert per bundel-sleutel. Geen state, geen triggers, geen materialized view: bij elke fetch opnieuw afgeleid uit de actuele ordergegevens. View levert: `order_ids[]`, `bundel_subtotaal_excl`, `drempel_gehaald`, `te_betalen_verzendkosten`, `bundel_besparing`. Frontend cachet via React Query (staleTime 60s) en invalidate't bij vervoerder-/adres-/datum-mutaties.

3. **Bevestigde bundel** ([`mig 230`](../supabase/migrations/230_zending_verzendweek_lock.sql)) — `zendingen` krijgt `verzendweek TEXT`-snapshot met backfill via `zending_orders` M2M. `start_pickronden_bundel` valideert nu ook **identieke verzendweek** (4e dimensie) en schrijft de week mee naar `zendingen`. Nieuwe trigger `trg_lock_zending_bundel_sleutel` blokkeert mutatie van `afleverdatum`/`afl_*`/`debiteur_nr` op orders die in een actieve bundel-zending zitten (`Klaar voor verzending`+) — voorkomt divergentie tussen pakbon-snapshot en order-data. Trigger `trg_zending_set_verzendweek` vult de week ook bij single-order paden.

4. **Factuur-bundel** ([`mig 231`](../supabase/migrations/231_factuur_queue_verzendweek.sql), [`mig 232`](../supabase/migrations/232_genereer_factuur_voor_week.sql)) — `factuur_queue` krijgt `verzendweek`-kolom. `enqueue_wekelijkse_verzamelfacturen` (mig 122) groepeert nu per (debiteur, ISO-week) i.p.v. alleen per debiteur, met dubbele-cron-bescherming via `NOT EXISTS`-check op pending/processing/done queue-rijen. Nieuwe RPC `genereer_factuur_voor_week(debiteur_nr, jaar_week)` — volgt mig 227 no-op-guard pattern, voegt per bundel-zending van die week 1 VERZEND-regel toe met drempel-toets. **Beleidskeuze**: verzendkosten worden **per bundel** geheven, niet per week — een bundel = 1 fysieke transportbeweging. 2 vervoerders in dezelfde week = 2 verzendkosten-regels (mits onder drempel). Edge function [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts) splitst nu op `item.type`: 'wekelijks' → `genereer_factuur_voor_week`; 'per_zending' → ongewijzigd `genereer_factuur` (V2-backlog: drempel-logica ook in per_zending-pad).

5. **UI / Live preview** ([`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx), [`pick-week-sectie.tsx`](../frontend/src/modules/magazijn/components/pick-week-sectie.tsx), [`voorgestelde-bundel-info.tsx`](../frontend/src/modules/magazijn/components/voorgestelde-bundel-info.tsx), [`drempel-progressbar.tsx`](../frontend/src/modules/magazijn/components/drempel-progressbar.tsx)) — Pick & Ship `KlantClusterBlok` toont nu in elke bundel een infostrip met vervoerder-pill, adres-snippet en `DrempelProgressBar` (slate < ½, amber ≥ ½, teal = gehaald). "Bespaart €X" badge als ≥2 orders. Updates live via React Query: vervoerder-override (`use-orderregel-vervoerder.ts`), afleverdatum-mutatie (`order-form.tsx`) en pickronde-start (`bulk-verzendset-button.tsx`) invalideren `['voorgestelde-bundels']`.

**Edge cases gedekt**:
- Vervoerder-override op orderregel locked op `is_locked` (mig 221); view filtert orders met actieve zending.
- Lock-trigger blokkeert adres-/datum-mutaties zodra bundel actief is.
- Cron `'facturatie-wekelijks'` (mig 122) heeft dubbele-vuur-bescherming via queue-existence-check.
- Afhalen-orders krijgen eigen `'AFHAAL'`-vervoerder-code in view en vallen niet samen met "GEEN".

**Niet in scope (V2-backlog)**: drempel-logica voor `per_zending`-pad, vervoerder-tarief-tabel, pgTAP-tests, real-time WebSocket-bundel-updates.

Typecheck schoon. Migraties 228-232 draaien op productie.

## 2026-05-08 — Edge-function regressie: `getKleurVariants is not defined` in `auto-plan-groep`

Vlak na het deployen van de "Auto-plan opnieuw draaien"-knop knalde de edge function in productie met `getKleurVariants is not defined`. Oorzaak: latente regressie uit commit `ce6136e` ("wip(snijplanning): uitwisselbare paren + snij-volgorde derive") — die commit verwijderde de `getKleurVariants`-helper uit [`supabase/functions/_shared/db-helpers.ts`](../supabase/functions/_shared/db-helpers.ts) maar liet drie aanroepen (in `db-helpers.ts:fetchStukken`, `check-levertijd:238`, `check-levertijd:289`) staan. Deno gooit pas op runtime in plaats van build-time, dus de bug overleefde tot vandaag.

**Fix**: helper opnieuw toegevoegd én geëxporteerd in [`db-helpers.ts`](../supabase/functions/_shared/db-helpers.ts) (zelfde signatuur als de frontend-versie in [`snijplanning.ts:32`](../frontend/src/lib/supabase/queries/snijplanning.ts) — accepteert "12" of "12.0" en levert beide varianten plus de gestripte vorm). `check-levertijd/index.ts` importeert de helper al uit deze file, dus die call-site is meteen ook gefixt.

**Te doen na deploy**: drie edge functions herdeployen omdat ze allemaal `db-helpers.ts` gebruiken — `auto-plan-groep`, `optimaliseer-snijplan`, `check-levertijd`:

```bash
npx supabase functions deploy auto-plan-groep --project-ref wqzeevfobwauxkalagtn
npx supabase functions deploy optimaliseer-snijplan --project-ref wqzeevfobwauxkalagtn
npx supabase functions deploy check-levertijd --project-ref wqzeevfobwauxkalagtn
```

## 2026-05-08 — Vervoerder-keuze refactor: Phase 6+7 cleanup (callers + barrel)

Afronding van de ADR-0008-refactor (vervoerder-keuze deep module). Phase 5 (commit `452a0a6`) had `use-vervoerder-config.ts` en `queries/vervoerder-config.ts` verwijderd; Phase 6+7 ruimt nu de overgebleven callers en de module-barrel op.

**Files** (al voor het grootste deel uncommitted in branch `fix/dpd-vervoerder-keuze`):
- [`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx) — bulk-override-flow + inline foutbanner met auto-hide na 5s + "Geen regel"-state met link naar `/verzendregels` + "Mix · DPD+UPS"-state.
- [`vervoerder-orderregel-pill.tsx`](../frontend/src/modules/logistiek/components/vervoerder-orderregel-pill.tsx) — imports geüpdatet naar `use-orderregel-vervoerder` + `use-vervoerders` (canonical master-list).
- [`bulk-verzendset-button.tsx`](../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx) — `useVervoerderPerOrder` vervangen door per-order `useVervoerderKeuzeVoorOrder`-aggregaten.
- [`vervoerder-filter-button.tsx`](../frontend/src/modules/logistiek/components/vervoerder-filter-button.tsx) — gebroken `'../hooks/use-vervoerder-config'`-import vervangen door `useVervoerdersFull` uit `use-vervoerders`.
- [`logistiek/index.ts`](../frontend/src/modules/logistiek/index.ts) — barrel-cleanup: shallow exports (`useKlantVervoerderConfig`, `useUpsertKlantVervoerderConfig`, `fetchKlantVervoerderConfig`, `upsertKlantVervoerderConfig`, `VervoerderRow`, `useVervoerderPerOrder`) verwijderd.
- [`queries/vervoerders.ts`](../frontend/src/modules/logistiek/queries/vervoerders.ts) (Task 7.2) — misleidende JSDoc over join via `edi_handelspartner_config` vervangen door eerlijke beschrijving (filter direct op `zendingen.vervoerder_code`).
- [`hooks/use-vervoerders.ts`](../frontend/src/modules/logistiek/hooks/use-vervoerders.ts) — stale comment over `use-vervoerder-config.ts` opgeruimd.
- [`__tests__/zendingen-query.contract.test.ts`](../frontend/src/modules/logistiek/__tests__/zendingen-query.contract.test.ts) — mock-builder uitgebreid met `.in()` (regressie door mig 219 die `.in('status', [...])` toevoegt aan `fetchZendingen`).

Typecheck schoon, tests groen (185 passed, 1 skipped).

## 2026-05-08 — Snijplanning: handmatige "Auto-plan opnieuw draaien"-knop in `voldoende`-tekortbanner

Productie-observatie: orderregel CISC 16 (300×200 stuk) bleef in de Tekort-tab staan terwijl [`snijplanning_tekort_analyse`](../supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql) bevestigde dat het stuk per-stuk-check op minstens één rol uit de uitwisselbare set (CAST/CISC/SOPI/SOPV/SPRI/VELV, 138 m²) zou moeten passen. De banner zei letterlijk "Draai auto-plan opnieuw" maar er was geen UI-actie om dat te doen — auto-plan wordt alleen automatisch getriggerd na opslaan van een order met maatwerk-regels of via [`useCreateSnijplan`](../frontend/src/hooks/use-snijplanning.ts). Tussen die triggers door kunnen rollen of voorraad veranderen zonder dat het systeem het oppikt.

**Fix** ([`groep-accordion.tsx`](../frontend/src/components/snijplanning/groep-accordion.tsx)):
- "Auto-plan opnieuw draaien"-knop in de tekort-banner, alleen voor `tekortReden.kind === 'voldoende'` (de andere kinds — `geen_collectie` / `geen_voorraad` / `rol_te_klein` — zijn niet oplosbaar door een herstart, daar is inkoop of config-wijziging nodig).
- Knop roept de bestaande [`useTriggerAutoplan`](../frontend/src/hooks/use-snijplanning.ts) aan met `(kwaliteitCode, kleurCode, totDatum)`. De hook invalidateerde al de juiste query-keys, dus de UI ververst automatisch zodra het voorstel auto-approved is.
- Errors worden hergebruikt op de bestaande `genError`-balk bovenin de accordion.
- Banner-tekst verkort: "Draai auto-plan opnieuw" weg uit de label-zin omdat de knop dat nu communiceert.

Geen migratie nodig; pure frontend-wijziging.

## 2026-05-08 — Mig 227: idempotente factuur-keten (no-op guard + atomic claim)

Vervolg op de eerder vandaag gefixte drain-deploy. De drain werkte daarna, maar produceerde voor 7 echte queue-rijen **22 facturen** — 7 met regels en bedragen, 14 lege €0,00 zonder regels. Diagnose:

1. **Race-condition aan drain-zijde**: [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts) deed `SELECT * FROM factuur_queue WHERE status='pending'` gevolgd door een aparte `UPDATE … SET status='processing'`. Tussen die twee calls kon een parallelle drain (cron-tik tegelijk met handmatige `net.http_post`) dezelfde rij claimen.
2. **Geen no-op guard in `genereer_factuur`** (mig 119/124): de RPC INSERT'eerde de factuur-header onvoorwaardelijk en SELECT'eerde regels pas daarna op `gefactureerd < orderaantal`. Bij een tweede aanroep voor reeds-gefactureerde orders waren er 0 regels te kopiëren — maar de header stond al, en bleef staan als lege €0,00 factuur.

**Fixes** ([`227_genereer_factuur_no_op_guard.sql`](../supabase/migrations/227_genereer_factuur_no_op_guard.sql)):
- `genereer_factuur` telt nu eerst de te-factureren regels en gooit `RAISE EXCEPTION 'al volledig gefactureerd'` (ERRCODE `no_data_found`) als dat 0 is. Geen header-INSERT, geen lege factuur. De aanroeper vangt de exception en de drain-error-pad markeert de queue-rij als `failed` (recovery-job vangt 'm op).
- Nieuwe RPC `claim_factuur_queue_items(p_max_batch)` doet één UPDATE met `FOR UPDATE SKIP LOCKED` — atomair claimen + naar `processing` zetten in één transactie. Parallelle drains slaan elkaars claims over.
- Drain-edge-function herschreven om `claim_factuur_queue_items` aan te roepen i.p.v. SELECT-then-UPDATE. Mark-processing-step verwijderd (zit nu in de RPC).

**Opruim-actie productie**: 14 lege facturen (FACT-2026-0010 t/m -0023) handmatig gedeletet via `DELETE FROM facturen WHERE id IN (…) AND totaal=0 AND created_at >= '2026-05-08 10:00'` plus `UPDATE nummering SET laatste_nummer = 9 WHERE type='FACT' AND jaar=2026`, zodat de volgende echte factuur weer FACT-2026-0010 wordt.

**Te doen na deploy**:
1. Migratie 227 toepassen op productie.
2. Edge function herdeployen: `npx supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn`.
3. Cron-job weer activeren: `UPDATE cron.job SET active = true WHERE jobname = 'facturatie-queue-drain';`.

## 2026-05-08 — Vervolg-hotfix: edge function `factuur-verzenden` deployen + `verify_jwt=false`

Na mig 226 bleek de queue nog steeds onaangetast (`attempts=0`). Inspectie van `net._http_response` toonde **`status_code=404`** met body `{"code":"NOT_FOUND","message":"Requested function was not found"}` op elke drain-tik. Oorzaak: de edge function `factuur-verzenden` was nooit gedeployd op productie — alleen lokaal in `supabase/functions/factuur-verzenden/index.ts` aanwezig.

**Fix**:
1. [`supabase/config.toml`](../supabase/config.toml) krijgt regel `[functions.factuur-verzenden]` met `verify_jwt = false`. Reden: drain stuurt `Authorization: Bearer <service_role_key>` uit Vault; met de huidige Supabase API-key-vorm (`sb_secret_*`) is dat geen geldige JWT en zou de Edge-gateway hem afwijzen als `verify_jwt=true`. De function leest zelf nooit een user-JWT (gebruikt service-role intern), dus de gateway-check is overbodig.
2. Edge function deployen: `npx supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn`.
3. Verifieer secrets in Supabase dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `FACTUUR_FROM_EMAIL` — vereist door [`factuur-verzenden/index.ts`](../supabase/functions/factuur-verzenden/index.ts) regel 15-19.

## 2026-05-08 — Hotfix mig 226: pg_cron `facturatie-queue-drain` registreren met juiste PROJECT_REF

Productie-incident: 7 zendingen op 'Klaar voor verzending' (per_zending-klanten FLOORPASSION/SB MÖBEL BOSS/WHOON), order-status correct geflipt naar 'Verzonden', `order_events.pickronde_voltooid` geschreven, en `factuur_queue` had 7 rijen op `status='pending'`. Maar `attempts=0` op alle rijen → de drain klopte niet op de queue.

**Diagnose** (`cron.job_run_details`): alleen `facturatie-queue-recovery` (jobid 4) draaide elke 5 min; geen enkele run van `facturatie-queue-drain`. Oorzaak: [`mig 122`](../supabase/migrations/122_facturatie_pg_cron.sql) bevatte letterlijk `<PROJECT_REF>` als placeholder met de instructie "vervang vóór apply" — bij apply op productie is dat niet gebeurd, en de scheduled command is daarna nooit functioneel geweest.

**Fix** ([`226_facturatie_drain_cron_hotfix.sql`](../supabase/migrations/226_facturatie_drain_cron_hotfix.sql)): idempotente unschedule + re-schedule met de echte URL `https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/factuur-verzenden`. Service-role-key in `vault.decrypted_secrets.service_role_key` was al aanwezig. Recovery- en wekelijkse jobs niet aangeraakt. Na apply: drain pikt elke minuut tot 5 pending-rijen op (PAGE_SIZE in [`factuur-verzenden`](../supabase/functions/factuur-verzenden/index.ts)), de 7 wachtende facturen worden binnen 1–2 cron-tikken verstuurd.

**Vervolgactie**: `<PROJECT_REF>`-placeholder in mig 122 was een tikkende tijdbom — vervangen door de echte ref of een `current_setting('app.project_ref')`-lookup verdient een aparte iteratie zodat de migratie zelf-applicabel wordt op nieuwe projecten zonder handmatige stap.

## 2026-05-08 — order-form invalideert pick-ship-cache bij save/delete

Vervolg op het pickbaarheidsfilter hieronder. `usePickShipOrders` heeft `staleTime: 30_000`, dus zonder expliciete invalidatie zag de operator een nieuw aangemaakte order pas na ±30 sec verschijnen op Pick & Ship. Voor het filter actief was viel dat minder op (de oude cache toonde de order alvast — alleen niet-pickbaar). Nu wel: [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx) invalideert `['pick-ship']` zowel bij save (create + update) als bij delete, naast de bestaande `['orders']` / `['snijplanning']` / etc. invalidaties.

## 2026-05-08 — Pick & Ship pickbaarheidsfilter (alle onpickbare redenen + lege orders)

Operator-feedback uit het magazijn: Pick & Ship liet orders zien die helemaal niet gepickt konden worden — maatwerk dat nog op snijden wacht, vaste maten in 'Wacht op inkoop', en zelfs Floorpassion-webshop-orders zonder gematchte productregels (`0 regels`). Magazijn moet daar telkens overheen scrollen om de echt-pickbare orders te vinden.

**Filter in [`fetchPickShipOrders`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts):**
- Een order verschijnt pas in Pick & Ship zodra **álle** regels `is_pickbaar=true` zijn. Reden voor onpickbaar (snijden, inkoop, confectie, inpak, géén regels) maakt niet uit.
- Klanten met `debiteuren.deelleveringen_toegestaan=true` zien een gemixte order al wél zodra ≥1 regel pickbaar is — operator stuurt een deellevering.
- Orders zonder enkele pickbare regel verdwijnen ook bij deelleveringen — niks te shippen.
- Geldt voor alle weekbuckets en stats (omdat `fetchPickShipStats` op dezelfde query leunt).

**Type:** [`OrderHeaderRij`](../frontend/src/modules/magazijn/queries/pick-ship-transform.ts) krijgt `deelleveringen_toegestaan: boolean` (uit debiteur-fetch). Niet doorgegeven aan `PickShipOrder`-shape — UI heeft 'm niet nodig.

**Tests:** [`magazijn-pickbaarheid.contract.test.ts`](../frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts) — scenario 2/4 verwachten nu 0 resultaten (header-only orders verdwijnen), scenario 3 (PGRST205-fallback) ook 0 (onbekende staat = niet tonen), scenario 5/6 dekken het wacht-op-snijden-pad, scenario 7 dekt het wacht-op-inkoop-pad.

## 2026-05-08 — Facturatie-Module (ADR-0007, mig 223)

Tweede deepening uit de architectuur-review: facturatie was verspreid over 7 frontend-locaties, 2 edge functions, en 6 SQL-migraties zonder Module-container. ADR-0005 noemde het als "kandidaat #3" en punt'te het door; nu opgepakt na de Order-lifecycle-keten van ADR-0006.

**Frontend-consolidatie** ([`modules/facturatie/`](../frontend/src/modules/facturatie/)):
- Smal-scope verhuizing: `pages/facturatie/`, `components/facturatie/factuur-lijst.tsx`, `hooks/use-facturen.ts`, `lib/supabase/queries/facturen.ts` → onder Module met barrel-export. Cross-cuts (`order-facturen.tsx`, `klant-facturering-tab.tsx`) blijven host-side maar consumeren via barrel.
- Nieuwe `queries/klant-factuur-instellingen.ts` + `useKlantFactuurInstellingen` / `useUpdateKlantFactuurInstellingen` hooks: Module bezit het concept-eigenaarschap van `factuurvoorkeur` + `btw_percentage` + `email_factuur` ondanks dat de velden op `debiteuren` staan. Klant-facturering-tab importeert via barrel.

**Trigger-migratie** ([`223_facturatie_event_listener.sql`](../supabase/migrations/223_facturatie_event_listener.sql)):
- `trg_enqueue_factuur` op `orders` (mig 118) gedropt; vervangen door `trg_enqueue_factuur_op_event` op `order_events`. Filter: `event_type='pickronde_voltooid' AND status_na='Verzonden'`. SECURITY DEFINER + `search_path = public` — zelfde RLS-bypass als de eerdere mig 218-hotfix omdat `factuur_queue` geen INSERT-policy voor authenticated heeft.
- Nieuwe kolom `factuur_queue.bron_event_id BIGINT REFERENCES order_events(id)`: traceert per factuur-job welke pickronde-completion 'm aanmaakte. NULL voor wekelijkse verzamelfacturen + legacy.
- Mig-nummer-noot: plan-spec sprak oorspronkelijk van mig 219, maar 219+220+221+222 raakten in gebruik door vervoerder + factuur-PDF + bundel-features. 223 is het eerstvolgende vrije nummer.

Termen *Facturatie-Module*, *factuurvoorkeur*, *factuur_queue* eerder toegevoegd aan [data-woordenboek.md](data-woordenboek.md). Beslissing en alternatieven: [ADR-0007](adr/0007-facturatie-als-deep-module.md).

## 2026-05-08 — Mig 222: zending-bundeling op afleveradres + vervoerder (B2B-pakbon-consolidatie)

Voor B2B-klanten met centraal magazijn (typisch inkoopgroepen als BEGROS) ontstonden er N losse pakbonnen wanneer de klant N losse orders had naar hetzelfde fysieke punt. Mig 222 voegt automatische bundeling toe vóór het picken: orders met identiek genormaliseerd afleveradres + dezelfde effectieve vervoerder, binnen dezelfde debiteur, krijgen 1 gezamenlijke pakbon (1 zending, 1 SSCC-set, 1 transportorder).

**Schema** ([`222_zending_bundeling_op_adres.sql`](../supabase/migrations/222_zending_bundeling_op_adres.sql))
- Nieuwe tabel `zending_orders(zending_id, order_id)` — M2M tussen zendingen en orders. Backfill maakt 1 rij per bestaande zending zodat solo's en bundels door dezelfde queries gelezen kunnen worden.
- Helper `_normaliseer_afleveradres(adres, postcode, land)` — uppercase, postcode-spaties weg, adres-spaties genormaliseerd. Match-key voor SQL-validatie + frontend-clustering.
- RPC `start_pickronden_bundel(order_ids[], picker_id)` — multi-order bundel-pickronde. Valideert: zelfde debiteur, identiek genormaliseerd adres, geen lopende of eindstatus-zendingen. Groepeert orderregels (over alle orders) op effectieve vervoerder uit mig 219 en maakt 1 zending per vervoerder-groep, gekoppeld aan alle betrokken orders. Bij 1 order delegeert naar `start_pickronden_voor_order` (mig 220).
- RPC `voltooi_pickronde` — bundel-aware: leest betrokken orders uit `zending_orders` en roept `markeer_verzonden` aan voor elke order waarvan dit de laatste open zending is. SECURITY DEFINER + search_path hersteld na CREATE OR REPLACE.

**Frontend**
- Cluster-helper [`bundel-cluster.ts`](../frontend/src/modules/magazijn/lib/bundel-cluster.ts) groepeert pickbare orders op `(genormaliseerd-adres × vervoerder)`. Bundels (≥2 orders) komen vóór solo's. Adres-normalisatie spiegelt 1-op-1 met `_normaliseer_afleveradres` in DB.
- [`BulkVerzendsetButton`](../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx) clustert eerst, kiest dan per cluster: bundel → `start_pickronden_bundel`, solo → `start_pickronden_voor_order`. Popover toont expliciet hoeveel adres-bundels gedetecteerd zijn.
- [`fetchZendingPrintSet`](../frontend/src/modules/logistiek/queries/zendingen.ts) haalt `zending_orders` op en levert `bundel_orders[]` op `ZendingPrintSet`. Order_regels include nu `order_id` voor groepering.
- [`PakbonDocument`](../frontend/src/modules/logistiek/components/pakbon-document.tsx): bij `bundel_orders.length > 1` toont het document alle order_nrs + per-order Uw-Referentie in het kop-blok, en groepeert artikelregels onder een sub-kop per bron-order zodat zowel magazijnier als ontvanger zien welke regel bij welke orderbevestiging hoort. Solo-zendingen gebruiken het ongewijzigde render-pad.

**Bedrijfsregels (CLAUDE.md)**
- Bundeling is automatisch maar veilig: alleen binnen 1 debiteur, alleen vóór er gepickt wordt, alleen bij identiek genormaliseerd adres + zelfde vervoerder. Eindstatus-zendingen blokkeren een nieuwe bundel-pickronde — operator moet eerst opruimen via /logistiek.

## 2026-05-08 — Factuur-PDF: Karpi-template (logo, oranje branding, dubbele bank, voorwaarden, m2/gewicht, afleveradres)

Een echte Karpi BV-factuur (FACT 26039757, 30 pagina's) als template gebruikt om de PDF-output 1-op-1 te matchen. Deze stap dekt zowel de tekstuele indeling als de visuele branding-elementen.

**Layout** ([`_shared/factuur-pdf.ts`](../supabase/functions/_shared/factuur-pdf.ts))
- Klantblok zonder bold (alle regels regular Courier)
- Order-headerlabels (`Ons Ordernummer`, `Uw Referentie`, `Afleveradres`) op vaste 16-tekens prefix-breedte zodat alle `:` uitlijnen
- Multi-line `omschrijving_2` (split op `\n`) — 3 regels per item: omschrijving + Band + Uw model
- TRANSPORTEREN/TRANSPORT-regels nu 3-koloms: label rechts, "BLAD" rechts, bedrag rechts
- Optionele "Totaal m2: X   Totaal gewicht (kg): Y"-regel boven het BTW-blok
- Afleveradres-blok in order-header (alleen bij eerste regel + alleen als afwijkend van factuuradres)

**Branding** (zelfde bestand)
- KARPI GROUP-logo gecentreerd bovenin (één keer geëmbedde JPG/PNG, hergebruikt per pagina via `page.drawImage` closure)
- Bedrijfsnaam (KARPI BV) in Karpi-oranje (rgb 0.76/0.53/0.22 — afgeleid uit logo's gouden lijn)
- Zware horizontale rule onder de header weggehaald (vervangen door de gouden lijn ín het logo)
- Footer: tweede bankregel onder de hoofd-bankregel als `bank2` is gevuld
- Footer: 3-koloms voorwaarden-tekst (NL/DE/EN, 4pt) met word-wrap, alleen renderen als minstens één taal is gevuld
- Nieuwe types: `BedrijfsBank`, `LogoOptie`, `FactuurAfleveradres`. `FactuurHeader` uitgebreid met `totaal_m2 + totaal_gewicht_kg`. `FactuurPDFInput` heeft optioneel `logo`-veld.

**Edge function** ([`factuur-pdf/index.ts`](../supabase/functions/factuur-pdf/index.ts))
- Joins toegevoegd naar `orders` (afleveradres-snapshot), `order_regels` (gewicht_kg, maatwerk_oppervlak_m2) en `producten` (lengte_cm/breedte_cm/vorm)
- m² per regel = `maatwerk_oppervlak_m2` of `(lengte × breedte) / 10000` voor rechthoek of `π × (diameter/200)²` voor `vorm='rond'`, × aantal
- Gewicht = SUM van `order_regels.gewicht_kg` (UNIQUE 1-op-1 mapping garandeert correct totaal)
- Afleveradres alleen als afwijkend van factuuradres (case-insensitive trim-vergelijking op adres + postcode)
- Logo wordt via service-role uit `public-assets/karpi-logo.jpg` gedownload (defaults; overrideable via `app_config.bedrijfsgegevens.logo_storage_*`); faalt download → PDF rendert zonder logo (best-effort)
- `bank2 + voorwaarden_nl/de/en` worden uit `app_config.bedrijfsgegevens` doorgegeven aan de renderer

**Migratie + upload-script**
- [`221_factuur_pdf_branding_assets.sql`](../supabase/migrations/221_factuur_pdf_branding_assets.sql) — maakt `public-assets`-bucket aan, vult `bedrijfsgegevens` met Commerzbank AG Bocholt + 3-talige voorwaarden + logo-pad. Idempotent + non-destructive merge: `defaults || waarde` zodat handmatig ingestelde sleutels in JSONB blijven winnen.
- [`scripts/upload-karpi-logo.mjs`](../scripts/upload-karpi-logo.mjs) — eenmalig CLI-uploadscript via Storage REST + service-role-key (uit `frontend/.env`).

**Tests** ([`_shared/factuur-pdf.test.ts`](../supabase/functions/_shared/factuur-pdf.test.ts)): 4 nieuwe tests — totaal m2/gewicht, multi-line omschrijving, afwijkend afleveradres, dubbele bank + voorwaarden-footer.

**Te doen na merge:**
1. Migratie 221 toepassen (`supabase db push` of via Studio).
2. Logo uploaden: `node scripts/upload-karpi-logo.mjs`.
3. Edge function deployen: `supabase functions deploy factuur-pdf`.
4. Bestaande factuur opnieuw bekijken — preview-render toont nu het volledige Karpi-template.

## 2026-05-08 — Per-orderregel vervoerder + auto-split in N zendingen (mig 219+220)

Op Pick & Ship was de vervoerder tot nu toe een **order-niveau** keuze: `preview_vervoerder_voor_order` (mig 215) draaide de verzendregel-evaluator op aggregaten van de order (MAX kleinste-zijde, SUM gewicht), en `start_pickronde` (mig 217+218) maakte 1 zending per order. Voor combi-orders (kleine matjes via DPD + grote rol via HST in dezelfde order) was dat te grof. Vraag uit de magazijn-flow: laat per orderregel zien welke vervoerder geldt, laat de magazijnier per regel afwijken, en als regels uiteenlopen → automatisch 2 zendingen.

- **[`219_orderregel_vervoerder_override.sql`](../supabase/migrations/219_orderregel_vervoerder_override.sql)** — kolom `order_regels.vervoerder_code` (NULL = volg order-default). Lock-trigger `trg_lock_orderregel_vervoerder` blokkeert wijziging zodra een open zending (NOT IN 'Geannuleerd','Afgeleverd') voor de regel bestaat — gevolg: de override is alleen beschikbaar **vóór** de Verzendset wordt gestart. Nieuwe RPC `effectieve_vervoerder_per_orderregel(order_id)` returnt per regel: override, evaluator-keuze (op per-regel attributen), klant-fallback uit `edi_handelspartner_config`, en de effectieve keuze + bron. Bron-precedentie: override > regel > klant_fallback > geen. Globaal-actief blijft een UI-fallback (geen DB-default), zodat de audit-trail eenduidig is.
- **[`220_start_pickronden_per_vervoerder.sql`](../supabase/migrations/220_start_pickronden_per_vervoerder.sql)** — nieuwe primitief `start_pickronden_voor_order(order_id, picker_id) RETURNS TABLE`: voor élke unieke effectieve vervoerder maakt hij 1 zending aan met de regels van die groep, vervoerder-code direct gezet bij INSERT (geen `selecteer_vervoerder_voor_zending`-roundtrip nodig voor de primaire keuze). Idempotent: bestaande Picken-zendingen per (order, vervoerder) worden hergebruikt; eindstatus-guard uit mig 218 blijft. `start_pickronde` is een dunne wrapper geworden die het eerste zending_id returnt, zodat bestaande callers/tests doorlopen op single-vervoerder-orders.
- **[`vervoerder-orderregel-pill.tsx`](../frontend/src/modules/logistiek/components/vervoerder-orderregel-pill.tsx)** — compacte per-regel pill in de uitklap van [`OrderPickCard`](../frontend/src/modules/magazijn/components/order-pick-card.tsx) met bron-iconen: `User` voor handmatige override, `Sparkles` voor regel-match, `Truck` voor klant-fallback, `Lock` als de zending al bestaat. Klik → dropdown met alle vervoerders + "Volg order-default". RPC-fout uit de lock-trigger wordt inline aan de gebruiker getoond.
- **[`startPickrondenVoorOrder` query + `useCreateZendingVoorOrder`-hook](../frontend/src/modules/logistiek/queries/zendingen.ts)** — return-shape verandert van `ZendingAanmaakResult` naar `ZendingAanmaakResult[]`. `VerzendsetButton`, `ZendingAanmakenKnop` en `BulkVerzendsetButton` checken op `length`: 1 → `/logistiek/{nr}/printset` (zoals voorheen), >1 → `/logistiek/printset/bulk?zendingen=NR1,NR2` zodat alle stickers + pakbonnen in één flow geprint worden.
- **[`222_zending_bundeling_op_adres.sql`](../supabase/migrations/222_zending_bundeling_op_adres.sql)** — orthogonale uitbreiding aan de andere kant van de keten: meerdere orders met identiek afleveradres + dezelfde effectieve vervoerder worden gebundeld in één pakbon-zending. Voor B2B-klanten met centraal magazijn (bv. inkoopgroep BEGROS) levert dat 1 pakbon i.p.v. N. Tabel `zending_orders` (M2M) + helper `_normaliseer_afleveradres()` + RPC `start_pickronde_bundel(order_ids[], picker_id)` + bundel-aware `voltooi_pickronde`. Frontend-kant: nieuwe [`bundel-cluster.ts`](../frontend/src/modules/magazijn/lib/bundel-cluster.ts) clustert pickbare orders op (debiteur, genormaliseerd adres+land, vervoerder), en [`BulkVerzendsetButton`](../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx) accepteert nu een cluster i.p.v. losse orders.

## 2026-05-08 — Hotfix: SECURITY DEFINER op alle ADR-0006 RPCs (RLS whack-a-mole stoppen)

Na de twee voorgaande hotfixes kwam een derde 42501 omhoog: `new row violates row-level security policy for table "order_events"`. Patroon herkend — `_apply_transitie` doet de INSERT in `order_events` en draait in de `authenticated`-context van de aanroepende user. Iedere RLS-tabel in de keten zonder INSERT-policy zou opnieuw falen, dus blanket-fix in plaats van per tabel achter de fouten aanlopen.

- **[`218_z_order_lifecycle_security_definer.sql`](../supabase/migrations/218_z_order_lifecycle_security_definer.sql)** — `ALTER FUNCTION ... SECURITY DEFINER` + `SET search_path = public` op `_apply_transitie`, `markeer_verzonden`, `markeer_geannuleerd`, `herbereken_wacht_status`, `herwaardeer_order_status` en `voltooi_pickronde`. Triggers die op orders-UPDATEs uit deze functies vuren erven de SECURITY-context, dus ook `trg_enqueue_factuur` is voortaan automatisch RLS-veilig (de aparte SECURITY DEFINER op `enqueue_factuur_bij_verzonden` blijft als dubbele safety).
- **Bestandsnaam-prefix `218_z_`**: alfabetisch achter `218_voltooi_pickronde_zending_status_fix.sql`. Cruciaal omdat die fix-migratie `CREATE OR REPLACE FUNCTION voltooi_pickronde` doet — en CREATE OR REPLACE reset functie-attributen (SECURITY DEFINER, SET clauses) terug naar de defaults. Bij replay van een schone DB moet onze ALTER dus ná de CREATE OR REPLACE draaien.
- _Patroon-keuze_: zelfde aanpak als mig 155 op `set_uitwisselbaar_claims`. Deze RPCs hebben input-validatie en gefixeerde shapes, geen vrije query op user-input, dus SECURITY DEFINER is veilig. Alternatief (breed `WITH CHECK (true)`-policy op elke betrokken tabel) zou onnodig privilege geven aan elke ingelogde gebruiker, ook voor interne audit-tabellen als `order_events`.

## 2026-05-08 — Order-lifecycle Module (ADR-0006, mig 218)

Eerste deepening uit de architectuur-review: `orders.status` had geen eigenaar, vier onafhankelijke schrijfpaden (mig 144/153, mig 217 voltooi_pickronde, frontend annulerings-UI). Dat patroon was een specimen-bug-klasse — ADR-0005 sloot het concrete factuur-keten-gat door één extra `UPDATE orders SET status='Verzonden'` toe te voegen, maar de oorzaak (verspreide schrijvers, geen audit-trail) bleef.

Mig 218 introduceert de **Order-lifecycle Module** als enige schrijver van het veld + `orders.verzonden_at`. Drie publieke RPCs als seam, één interne helper:

- **[`218_order_lifecycle_module.sql`](../supabase/migrations/218_order_lifecycle_module.sql)** — enum `order_event_type` (4 waarden) + tabel `order_events` (typed audit-log met polymorfe actor: medewerker XOR auth.user). Drie RPCs: `markeer_verzonden(p_order_id, p_actor_*)`, `markeer_geannuleerd(p_order_id, p_reden, p_actor_*)`, `herbereken_wacht_status(p_order_id)`. Interne `_apply_transitie` is de enige plek die `UPDATE orders SET status` doet — atomair: status + verzonden_at + INSERT order_events. Bestaande callers `voltooi_pickronde` (mig 217) en `herwaardeer_order_status` (mig 153) gaan via `CREATE OR REPLACE` over op het nieuwe pad. Backfill: per bestaande order één synthetisch `aangemaakt`-event op `orderdatum::timestamptz`. CHECK-constraint pragmatisch (verbiedt alleen spook-status `Klaar voor verzending`); strict-pad in vervolg-iteratie. Sentinel-cleanup in 6 RPCs is om deze reden uitgesteld.
- **[`frontend/src/modules/orders-lifecycle/`](../frontend/src/modules/orders-lifecycle/)** — barrel-export, drie RPC-wrappers met contract-tests (6/6 PASS), `useMarkeerGeannuleerd`-hook met query-invalidaties op `['orders']`, `['order', id]`, `['order-events', id]`.
- **[`order-header.tsx`](../frontend/src/components/orders/order-header.tsx)** — Annuleer-knop met confirm-dialog, alleen zichtbaar voor non-eindstatussen. Placeholder reden `Handmatig geannuleerd via UI`; vrij invulbaar reden-veld als UX-uitbreiding open.
- **[`scripts/lint-no-direct-orders-status-update.sh`](../scripts/lint-no-direct-orders-status-update.sh)** + npm-script `lint:order-status` — voorkomt regressie naar "veld zonder eigenaar". Scant frontend/src + supabase/migrations/2*.sql; allowlist alleen `218_order_lifecycle_module.sql`. Legacy 145/153/217 staan buiten scope.

Termen *Order-lifecycle* en *order_events* toegevoegd aan [data-woordenboek.md](data-woordenboek.md#L81-L82). Beslissing en alternatieven: [ADR-0006](adr/0006-order-lifecycle-als-deep-module.md). Uitvoeringsplan: [`2026-05-07-order-lifecycle-en-facturatie-modules.md`](superpowers/plans/2026-05-07-order-lifecycle-en-facturatie-modules.md).

## 2026-05-08 — Pick & Ship: bundels visueel duidelijker

Op de Pick & Ship-overview werden klant-bundels (≥2 orders naar dezelfde debiteur) tot nu toe in een lichte slate-50 wrapper gepresenteerd met een kleine grijze sub-kop. In één oogopslag was niet te zien dát het een bundel betrof — de magazijnier moest de tekst lezen om "(4 orders)" te herkennen, met als risico dat klant-clusters per ongeluk los worden afgehandeld i.p.v. via de bulk-knop.

- **[`pick-week-sectie.tsx`](../frontend/src/modules/magazijn/components/pick-week-sectie.tsx)** — `KlantClusterBlok` herstijld naar een herkenbaar bundel-frame: 2px terracotta-400-border + zachte terracotta-100/60-tint + 6px terracotta-500-accent-streep aan de linkerkant. Kop kreeg een prominente "BUNDEL"-badge (terracotta-500 + Layers-icoon, all-caps), klantnaam in semibold terracotta-600, en de telling als witte pill met terracotta-rand i.p.v. losse grijze tekst. De bulk-printknop blijft rechts uitgelijnd.
- _Waarom_: terracotta is de huiskleur die elders al "actie / klant" signaleert — door diezelfde tint hier consistent in te zetten, herken je het cluster vóór je ook maar één tekst leest. De accent-streep links is genoeg context om bundel ↔ losse-order in de scan-fase te scheiden, zonder de pick-card-tinten (oranje/blauw/paars voor maatwerk/std/combi) te verstoren.

## 2026-05-08 — Hotfix: factuur-trigger faalde op RLS (42501)

Direct na de `zending_status`-hotfix kwam een tweede fout omhoog: `new row violates row-level security policy for table "factuur_queue"`. De order-status-flip naar `Verzonden` slaagt nu, maar de AFTER-UPDATE-trigger `trg_enqueue_factuur` (mig 118) draait in de context van de aanroepende `authenticated`-user en die heeft geen INSERT-policy op `factuur_queue`. Mig 155 documenteerde exact dit "Supabase fase-1 RLS-enabled zonder policies"-scenario voor `order_reserveringen`.

- **[`218_enqueue_factuur_security_definer.sql`](../supabase/migrations/218_enqueue_factuur_security_definer.sql)** — `ALTER FUNCTION enqueue_factuur_bij_verzonden() SECURITY DEFINER` + `SET search_path = public`. De trigger draait nu als owner en omzeilt RLS, dezelfde aanpak als mig 155 voor `set_uitwisselbaar_claims`.
- _Waarom niet een breed INSERT-policy op factuur_queue?_ De queue is intern: alleen drie system-paths schrijven erin (deze trigger, mig 122 cron-job voor wekelijks-klanten, mig 121 recovery-RPC) en de edge function `factuur-verzenden` leest via service_role. Een `WITH CHECK (true)` voor authenticated zou willekeurige queue-injectie door ingelogde gebruikers toestaan — onnodig privilege voor een tabel die niet via UI bewerkt wordt.

## 2026-05-08 — Hotfix: voltooi_pickronde gooide 22P02 op zending_status enum

Bij "Voltooi pickronde" op de pick-overview (ZEND-2026-0004 / ORD-2026-2038) faalde de RPC met `invalid input value for enum zending_status: "Geannuleerd"`. Oorzaak: de open-zendingen-telling in `voltooi_pickronde` (mig 217 → mig 218 order-lifecycle) bevatte een `status NOT IN (..., 'Geannuleerd')` terwijl de enum (def mig 169) die waarde nooit gehad heeft — Postgres valideert enum-literals tijdens execution, dus dit pad is sinds mig 217 nooit succesvol gerund. Pas nu in productie geraakt omdat het de eerste keer was dat een verzendset met de nieuwe factuur-keten-flow werd voltooid.

- **[`218_voltooi_pickronde_zending_status_fix.sql`](../supabase/migrations/218_voltooi_pickronde_zending_status_fix.sql)** — `CREATE OR REPLACE FUNCTION voltooi_pickronde(BIGINT, BIGINT)` met `'Geannuleerd'` weggehaald uit de NOT IN-lijst. Verder identiek aan mig 218 order-lifecycle. Migratiebestand zit alfabetisch achter `218_order_lifecycle_module.sql`, dus de fix wint bij replay. COMMENT vermeldt expliciet dat zending-cancellation geen V1-scope is — bij invoer ervan moet aparte migratie de enum uitbreiden plus een `markeer_zending_geannuleerd`-RPC introduceren.
- _Waarom_: zending-cancellation is geen V1-feature; de literal was speculatief geschreven voor toekomstige flexibiliteit, maar maakte het hele factuur-keten-pad stuk. Werkende vervangwaarde is een lege filter (negatief) op alleen de drie eindstatussen `Klaar voor verzending`, `Onderweg`, `Afgeleverd` — dat dekt alle "afgesloten" zendingen die de enum momenteel kent.

## 2026-05-07 — Vervoerder-precedentie: regels boven klant-fallback

Bij het testen van de regels (mig 215) op FLOORPASSION (#260000) bleek dat een ingestelde regel "NL + ≥27kg + ≥131cm → Verhoek" niet doorwerkte op de pick-card; de pill bleef Rhenus tonen. Oorzaak: in `edi_handelspartner_config` stond voor deze klant `vervoerder_code='edi_partner_a'` (Rhenus) — een legacy-rij van vóór de regel-evaluator. De UI-precedentie zette die klant-keuze **boven** de regels, dus de regels werden compleet genegeerd zolang de override bestond.

- **[`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx)** + **[`use-vervoerder-per-order.ts`](../frontend/src/modules/logistiek/hooks/use-vervoerder-per-order.ts)** — Effectieve-vervoerder volgorde omgedraaid naar **(1) regel-preview > (2) klant-fallback > (3) globaal-actief**. De klant-config blijft bestaan, maar fungeert nu als fallback wanneer geen regel matcht (i.p.v. harde override). Tooltip-tekst aangepast ("Klant-fallback (geen regel matcht): X"), dropdown-header "Override voor klant" → "Klant-fallback (gebruikt bij geen regel-match)".
- _Waarom_: regels zijn de canonieke routing-bron — een per-klant-override blokkeerde stilzwijgend de regels en maakte ze onbetrouwbaar voor magazijn-runs. Door de prio om te draaien wint de regel altijd, en is de klant-fallback alleen relevant voor klanten waar geen regel voor bestaat (specifieke afspraak met die klant). Bestaande klant-configs (FLOORPASSION + 2 anderen op DPD) blijven intact en werken vanaf nu als documenteerbare fallback.

## 2026-05-07 — Pick & Ship: filter op vervoerder

Op de Pick & Ship-overzichtspagina was tot nu toe alleen op verzendweek + zoekterm te filteren. Voor magazijn-runs (eerst alle Rhenus-orders, daarna afhalen, dan Verhoek) werkte dat onhandig — je moest de pickkaarten visueel scannen op de vervoerder-pill. Met meerdere vervoerders per week wordt dat foutgevoelig.

- **[`useVervoerderPerOrder`](../frontend/src/modules/logistiek/hooks/use-vervoerder-per-order.ts)** — Page-level resolver die per order de effectieve vervoerder bepaalt met dezelfde precedentie als `VervoerderInlineSelect`: klant-config (`edi_handelspartner_config`) > regel-preview (`preview_vervoerder_voor_order`) > globaal-actief. Klant-config wordt ééns ge-batched opgehaald voor alle unieke `debiteur_nrs`; preview-RPCs delen cache met de pick-card-inline-selects via dezelfde `['logistiek', 'vervoerder-preview', orderId]`-keys, dus geen dubbele round-trips.
- **[`VervoerderFilterButton`](../frontend/src/modules/logistiek/components/vervoerder-filter-button.tsx)** — Pill-vormige dropdown naast "Groeperen op land" met opties `Alle vervoerders`, één per geregistreerde vervoerder (HST / Rhenus / Verhoek), `Afhalen`, en `Geen / handmatig`. Counts achter elke optie spiegelen de huidige bucket zodat je vooraf ziet of een filter iets oplevert. Vervoerders die niet actief zijn én niet voorkomen in de huidige bucket worden weggelaten.
- **[`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)** — Nieuwe `vervoerderFilter`-state die tussen bucket-filter en week-groepering schuift: `gefilterd` (per bucket) → `naVervoerderFilter` (per vervoerder) → `perWeek` (groepering). Pickronde-cards en bulk-knoppen (`PickWeekSectie`) krijgen alleen orders die door beide filters komen.
- **[`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)** — Order-type-tinten van 50/200 → 100/300 gebumpt: `std` blauw (sky-100), `maatwerk` oranje (orange-100), `combi/mix` paars (violet-100). De zacht-blauwe std-tint stak nauwelijks af tegen de witte pagina-achtergrond, waardoor de drie types in één rij niet snel te onderscheiden waren.
- _Architectuur_: ADR-0002 blijft intact — magazijn weet niets van vervoerders, de filter-knop + resolutie-hook leven volledig in `modules/logistiek` en worden door pick-overview als slot geconsumeerd. De `PickShipOrder`-shape blijft ongewijzigd.

## 2026-05-07 — Factuur ↔ order zichtbaar maken + live PDF-preview

Bij het testen van de facturatie-module bleek de UI nog gaten te hebben: vanuit een order was niet te zien of er een factuur aan hing, en omgekeerd kon je voor Concept-facturen geen PDF inzien — die werd pas gegenereerd door de queue-flow op `orders.status='Verzonden'`. Voor demo's, controle vóór verzending en handmatig nakijken is dat onhandig.

- **[`factuur-pdf` edge function](../supabase/functions/factuur-pdf/index.ts)** + **[`config.toml`](../supabase/config.toml)** — Nieuwe edge function (`verify_jwt=false` i.v.m. publishable-key gateway-check) die voor elk `factuur_id` real-time een PDF rendert via dezelfde shared `genereerFactuurPDF`-helper als `factuur-verzenden`. Geen DB-mutaties, geen mail, geen EDI — pure preview/download. Streamt `application/pdf` als response.
- **[`factuur-detail.tsx`](../frontend/src/pages/facturatie/factuur-detail.tsx)** — Knop "Download PDF" werkt nu altijd: bij gevulde `pdf_storage_path` via signed URL uit storage, anders via de nieuwe edge function. Label wisselt naar "Bekijk PDF (preview)" voor Concept-facturen, met loading-state en foutmelding-banner. Klant-blok toont nu klantkaart-link, klantnummer en een expliciete amber-melding als adresvelden NULL zijn (zichtbaar bij de Floorpassion-verzameldebiteur).
- **[`renderFactuurPdfBlobUrl`](../frontend/src/lib/supabase/queries/facturen.ts)** + **[`fetchFacturenVoorOrder` / `fetchFacturenVoorOrders`](../frontend/src/lib/supabase/queries/facturen.ts)** + hooks — Drie nieuwe queries: één voor de live PDF-blob, twee voor de order ↔ factuur-koppeling (single + batched-IN-clause om N+1 te voorkomen).
- **[`OrderFacturen`-blok](../frontend/src/components/orders/order-facturen.tsx)** op order-detail — toont gekoppelde factuur(en) met status-badge, datum, totaal en deeplink naar `/facturatie/{id}`. Lege staat: "Nog niet gefactureerd".
- **Factuur-kolom in [orders-table](../frontend/src/components/orders/orders-table.tsx)** — orderlijst krijgt extra kolom met factuurnr-link; `+N`-indicator als er meerdere facturen aan een order hangen (verzamelfactuur-scenario). Eén batched query per pagina via `useFacturenVoorOrders`.
- _Waarom_: de queue-flow (mig-118 trigger op `Verzonden`) is canoniek voor mail-verzending, maar voor handmatig inzien moet de PDF onmiddellijk beschikbaar zijn — ook bij Concept. Tegelijk werd "TEST-FACT-001" als `klant_referentie` op een testorder verward met een factuurnummer; het ontbreken van een expliciete order ↔ factuur-koppeling in de UI maakte dat erger. Beide nu opgelost zonder wijzigingen aan het canonieke datamodel of de queue-trigger.

## 2026-05-07 — Mig 217: Pickronde sluit factuur-keten + Picker-audit (ADR-0005)

Tijdens de architectuur-grilling kwam aan het licht dat `orders.status='Verzonden'` een dode status was: nergens werd hij gezet. Mig-118 factuur-trigger wachtte op precies die overgang en vuurde dus nooit. Tegelijkertijd had de Pickronde geen actor-registratie — `gepickt_at` was een audit-timestamp zonder picker. Met de Medewerker-tabel uit mig 216 kunnen we nu beide opvangen: voltooi_pickronde sluit de keten naar de factuur, en alle Pickronde-RPCs eisen een picker_id.

- **[`217_pickronde_picker_factuur_keten.sql`](../supabase/migrations/217_pickronde_picker_factuur_keten.sql)** — `orders.verzonden_at TIMESTAMPTZ`, `zendingen.picker_id` (FK → medewerkers.id), `zending_colli.gepickt_door_id` (FK → medewerkers.id). RPCs `start_pickronde`, `voltooi_pickronde`, `markeer_colli_niet_gevonden` en `create_zending_voor_order` accepteren nu `p_picker_id` als verplichte parameter — gevalideerd via interne helper `_valideer_picker` (must be active medewerker met rol 'picker'). Oude 1-arg/3-arg signaturen gedropt. **Sluitstuk factuur-keten in `voltooi_pickronde`**: na zending-status-flip wordt gecheckt of álle zendingen van de order op `Klaar voor verzending`/`Onderweg`/`Afgeleverd` staan; zo ja → `orders.status='Verzonden'` + `verzonden_at=now()`. trg_enqueue_factuur (mig 118) vuurt automatisch — keten compleet. Bij deelleveringen vuurt dit pas bij de laatste pickronde.
- **[`pickronde.ts`](../frontend/src/modules/magazijn/queries/pickronde.ts)** + **[`pickronde.contract.test.ts`](../frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts)** — RPC-wrappers `startPickronde(orderId, pickerId)`, `voltooiPickronde(zendingId, pickerId)`, `markeerColliNietGevonden({colliId, modus, opmerking, pickerId})`. 8 contract-tests bewijzen de juiste argumenten + propagation van picker-validatie-fouten.
- **[`use-pickronde.ts`](../frontend/src/modules/magazijn/hooks/use-pickronde.ts)** — Mutaties accepteren `{orderId/zendingId, pickerId}` object. `useVoltooiPickronde` invalideert ook `orders` en `facturen`-keys (factuur kan vuren).
- **[`PickerDropdown`](../frontend/src/components/orders/picker-dropdown.tsx)** — Herbruikbare component, light-weight (alleen actieve pickers via `usePickers`). Toont een hint-link naar `/instellingen/medewerkers?tab=pickers` als nog geen pickers zijn aangemaakt. Compact-variant voor in tabel-cellen.
- **[`VerzendsetButton`](../frontend/src/modules/logistiek/components/verzendset-button.tsx)** + **[`ZendingAanmakenKnop`](../frontend/src/components/orders/zending-aanmaken-knop.tsx)** — Klik opent picker-popover (relative-positioned, click-outside-to-close). localStorage onthoudt laatste picker (`rugflow.last-picker-id`) — twee-klik flow per order, één seconde extra, expliciete audit. Pas op submit gaat de zending naar staging.
- **[`ZendingPrintSetPage`](../frontend/src/modules/logistiek/pages/zending-printset.tsx)** — Tijdens `Picken`-status verschijnt boven de colli-vinkjes een PickerDropdown ("Picker (verplicht voor voltooi + niet-gevonden audit)"). Pre-fill: `zending.picker_id` van start_pickronde > localStorage > leeg. Operator mag wisselen bij shift-overgang. Wordt gepersisteerd zodra hij voltooi/markeer doet.
- **[`OrderHeader`](../frontend/src/components/orders/order-header.tsx)** — Naast status-badge toont nu `op {datum}` als status='Verzonden' en verzonden_at gevuld is — visueel bewijs dat de factuur-keten gevuurd heeft.
- _Waarom_: methodiek-keten "klaarligt → bevestigd → factuur de deur uit" werkt nu eind-tot-eind. Audit-trail per colli (`gepickt_door_id`) maakt productiviteit-rapportage en pick-problemen-debug mogelijk. ADR-0005 documenteert de keuze om bij deelleveringen pas op de laatste pickronde te flippen (één bundel-factuur per order).

## 2026-05-07 — Mig 216: Medewerker-tabel met rol-tags (ADR-0004)

Methodiek-vraag van Miguel ("bij stickers uitdraaien moet je de picker kiezen") legde een gat bloot: er was geen tabel voor magazijn-medewerkers en de Pickronde-RPCs accepteerden geen actor. Een tweede `pickers`-tabel naast `vertegenwoordigers` zou bij elke nieuwe rol (magazijnchef, inkoper) een tabel-explosie geven. Beter: één identity-tabel met rol-tags.

- **[`216_medewerker_tabel.sql`](../supabase/migrations/216_medewerker_tabel.sql)** — Hernoemt `vertegenwoordigers` → `medewerkers`. Voegt enum `medewerker_rol` (`vertegenwoordiger | picker`) toe en `rollen medewerker_rol[]` kolom op de tabel. Backfill bestaande rijen met `rollen={'vertegenwoordiger'}`. Code mag voortaan NULL zijn (pickers hebben geen 3-4 letter code). Defensieve sequence-koppeling via `pg_get_serial_sequence` omdat `id` al bestond op vertegenwoordigers — `ADD COLUMN BIGSERIAL` zou de sequence-machinery dan overslaan. Compat-view `vertegenwoordigers` filtert op rol zodat pre-mig-216 callers blijven werken.
- **[`medewerkers.ts`](../frontend/src/lib/supabase/queries/medewerkers.ts)** — Nieuwe query-laag: `fetchMedewerkers(rol?)`, `fetchPickers()` (alleen actief), `createPicker(naam)`, `updateMedewerker(id, patch)`, `addRolToMedewerker`, `removeRolVanMedewerker`. Multi-rol via array-merge.
- **[`use-medewerkers.ts`](../frontend/src/hooks/use-medewerkers.ts)** + **[`use-pickers.ts`](../frontend/src/hooks/use-pickers.ts)** — TanStack hooks; `usePickers` heeft 5min staleTime voor de pick-dropdown.
- **[`/instellingen/medewerkers`](../frontend/src/pages/instellingen/medewerkers.tsx)** — Nieuwe instellingen-pagina met tabs Vertegenwoordigers (read-only lijst + link naar volledig overzicht voor omzet/tiers) + Pickers (CRUD via [`PickerFormDialog`](../frontend/src/components/instellingen/picker-form-dialog.tsx)).
- **[Sidebar](../frontend/src/lib/utils/constants.ts)** — Link "Medewerkers" toegevoegd onder Systeem/Instellingen. `/vertegenwoordigers` blijft bestaan als bestaande analytics-pagina (omzet, tiers, klanten-koppeling).
- **Contract-test** [`medewerker-rollen.contract.test.ts`](../frontend/src/modules/magazijn/__tests__/medewerker-rollen.contract.test.ts) — 9 tests dekken `fetchPickers`-filter, `createPicker`-shape, `addRolToMedewerker`-union, `removeRolVanMedewerker`-filter. Mocked-supabase patroon conform `pickronde.contract.test.ts`.
- _Waarom_: zet de basis voor ADR-0005 (mig 217) waar `start_pickronde` en `voltooi_pickronde` een `picker_id`-parameter krijgen. Domeinwoordenboek: nieuwe sectie "Medewerkers & Rollen" met termen Medewerker, Rol (medewerker), Picker.

## 2026-05-07 — Mig 215: regel-evaluator-preview op pick-card vóór verzending

De `VervoerderInlineSelect`-pill toonde tot nu toe alleen de klant-default of de globaal-actieve vervoerder ("Kies" als er meerdere actief zijn). De verzendregels (mig 208/210/214) draaiden pas bij klikken op "Verzendset", dus de gebruiker kon vooraf niet zien welke vervoerder de regels zouden kiezen voor deze specifieke order. Verwarrend nadat we net regels hadden ingesteld voor DE/NL.

- **[`215_preview_vervoerder_voor_order.sql`](../supabase/migrations/215_preview_vervoerder_voor_order.sql)** — Nieuwe RPC `preview_vervoerder_voor_order(p_order_id)` met identieke return-shape als `selecteer_vervoerder_voor_zending` (mig 210), maar attributen vanuit `orders` + `order_regels`-aggregatie i.p.v. zending. Zelfde `matcht_regel`-loop, dus identieke uitkomst zonder zending te hoeven aanmaken. STABLE-functie zodat TanStack Query 'm kan cachen.
- **[`verzendregels.ts`](../frontend/src/modules/logistiek/queries/verzendregels.ts)** — `previewVervoerderVoorOrder(orderId)` + `VervoerderPreview`-type met getypeerde `keuze_uitleg`-shape (match_regel_id, match_prio, match_conditie, match_notitie, of `reden: 'afhalen' | 'geen_matchende_regel'`).
- **[`use-verzendregels.ts`](../frontend/src/modules/logistiek/hooks/use-verzendregels.ts)** — `useVervoerderPreview(orderId)` hook met 30s staleTime; korte cache zodat een net-gewijzigde regel of orderafmeting direct doorwerkt op de pill.
- **[`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx)** — Effectieve-vervoerder volgorde nu: **(1) klant-config override > (2) regel-preview > (3) globaal-actieve fallback**. Pill toont een Sparkles-icoon i.p.v. Truck wanneer de keuze uit de regels komt, met de match-notitie in de tooltip ("DE + tapijt >130cm → Rhenus (pallet)"). Dropdown krijgt een purple "Regel-keuze"-blok bovenaan dat laat zien welke regel matchte; bij `reden=geen_matchende_regel` een amber waarschuwing met de suggestie om een regel toe te voegen. Sectie-label "Vervoerder voor klant" → "Override voor klant" om duidelijk te maken dat dit een handmatige overrule is.
- _Waarom_: gebruiker stelt regels in en moet direct kunnen zien dat ze werken — niet pas na het aanmaken van een verzendset. De preview-RPC laat ook auditing toe ("welke vervoerder zou ik krijgen als ik nu zou versturen?") zonder echte bijwerking. Klant-config blijft als handmatige override behouden voor edge-cases waar een klant uitdrukkelijk een eigen vervoerder wil.

## 2026-05-07 — Pick & Ship: vervoerder-pill werkt ook door op de sticker

De `VervoerderInlineSelect`-pill op de pick-overzicht-card schreef alleen naar `edi_handelspartner_config.vervoerder_code` — een klant-default voor *toekomstige* zendingen. De sticker leest echter `zendingen.vervoerder_code` (gezet bij `start_pickronde` via `selecteer_vervoerder_voor_zending`). Resultaat: gebruiker wijzigde de pill naar bv. "Rhenus", maar het verzendset-PDF bleef "HST" tonen — zoals zichtbaar op pick & ship voor ORD-2026-2034.

- **[`vervoerder-config.ts`](../frontend/src/modules/logistiek/queries/vervoerder-config.ts)** — Nieuwe query `updateZendingVervoerderVoorOrder(order_id, vervoerder_code)` die de lopende zending van één order overschrijft. Filter op `status IN ('Gepland', 'Picken', 'Ingepakt', 'Klaar voor verzending')` zodat reeds verzonden zendingen ('Onderweg', 'Afgeleverd') ongewijzigd blijven voor het audit-spoor.
- **[`use-vervoerder-config.ts`](../frontend/src/modules/logistiek/hooks/use-vervoerder-config.ts)** — `useUpsertKlantVervoerderConfig` accepteert nu een optionele `order_id`. Wanneer aanwezig wordt na de klant-config-upsert ook de zending-update gedaan, en worden `['logistiek', 'zending-printset']`, `['logistiek', 'zending']` en `['logistiek', 'zendingen']` geïnvalideerd zodat de printset-pagina meteen de nieuwe vervoerder oppakt.
- **[`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx) + [`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)** — `orderId`-prop toegevoegd; pick-card geeft `order.order_id` mee. Klant-detailpagina ([`klant-vervoerder-tab.tsx`](../frontend/src/components/klanten/klant-vervoerder-tab.tsx)) blijft zonder `order_id` werken (alleen klant-default, oude semantiek).
- _Waarom_: gebruikersverwachting — "als ik hier de vervoerder wijzig, dan moet dat ook wel toegepast worden op de sticker." De fix grijpt in op het bestaande knip-punt (zending al aangemaakt door `start_pickronde`) en laat eindstatussen ongemoeid; geen DB-migratie nodig.

## 2026-05-07 — Mig 214: land-normalisatie in regel-evaluator

`orders.afl_land` (en de gekopieerde `zendingen.afl_land`) is een vrij TEXT-veld — afhankelijk van de orderbron stond er `'NL'`, `'Nederland'`, `'Holland'`, `'BELGIË'`, of `'NL '`. De regel-evaluator `matcht_regel` (mig 210) deed exacte string-equality, dus een regel `land:['NL']` matchte wel orders met `afl_land='NL'` maar niet met `afl_land='Nederland'`. Stille fallthroughs naar generiekere regels of "geen vervoerder gekozen" waren het gevolg.

- **[`214_normaliseer_land_in_regel_evaluator.sql`](../supabase/migrations/214_normaliseer_land_in_regel_evaluator.sql)** — Nieuwe functie `normaliseer_land(TEXT)` die ISO-2 als-is doorgeeft (2 letters → uppercase) en volledige landnamen mapt naar ISO-2. Strip whitespace en de meest voorkomende diakritieken (Á/É/Í/Ó/Ú/Ç/Ñ + accenten) zonder de `unaccent`-extensie te introduceren — Karpi gebruikt geen Postgres-extensies en de set landen rond het afzetgebied is klein en stabiel.
- **`matcht_regel`** — Beide kanten van de land-vergelijking gaan nu door `normaliseer_land()`: zowel de regel-conditie `land[]` als `zending.afl_land`. Resultaat: een regel met `land:['NL']` matcht alle varianten ('NL', 'Nederland', 'Holland', 'NETHERLANDS'); een regel met `land:['Nederland']` matcht óók orders met `afl_land='NL'`. Andere conditiesleutels (gewicht, kleinste_zijde, debiteur_nrs, inkoopgroep_codes) zijn ongewijzigd.
- **Geen schemamutatie** — alleen `CREATE OR REPLACE` op functies, idempotent. Bestaande regels en zendingen werken zonder data-fix.
- _Waarom_: handmatig aangemaakte orders, webshop-orders en EDI-orders schrijven het land niet uniform. We willen dat verzendregels robuust matchen ongeacht hoe de bron het land heeft genoteerd, zonder data-cleanup over alle historische orders te hoeven doen.

## 2026-05-07 — Pick & Ship: bulk-stickers printen op klant- en land-niveau

In de pick-week-tab kon je tot nu toe alleen per order een verzendset starten. Bij een klant met meerdere orders (bv. FLOORPASSION 2 orders) of bij een land-groep wil de magazijnier in één klik alle stickers + pakbonnen uit de printer.

- **[`bulk-verzendset-button.tsx`](../frontend/src/modules/logistiek/components/bulk-verzendset-button.tsx)** _(nieuw)_ — Knop die de pickbare verzend-orders uit de groep filtert (`!afhalen && allRegelsPickbaar`), sequentieel `create_zending_voor_order` aanroept met live voortgangsteller (`Bezig... 2/5`), en bij succes navigeert naar de bulk-printset-pagina. Verschijnt alleen bij ≥2 printbare orders — single-order is goed gedekt door de bestaande `<VerzendsetButton>`. Bij partial fail blijven aangemaakte zendingen staan en wordt een herstelbaar bericht getoond.
- **[`pages/bulk-printset.tsx`](../frontend/src/modules/logistiek/pages/bulk-printset.tsx)** _(nieuw)_ — Route `/logistiek/printset/bulk?zendingen=Z1,Z2,…`. Laadt alle zending-printsets parallel via `useQueries` en rendert per zending de stickers + A4-pakbon achter elkaar in één scrollbaar document, met dezelfde print-CSS als de single-zending pagina (één `window.print()`-aanroep produceert het hele stapeltje). Header toont `N zendingen · M colli totaal`.
- **[`lib/printset.ts`](../frontend/src/modules/logistiek/lib/printset.ts)** _(nieuw)_ — `expandLabels`, `vervoerderInfoVoor`, `labelFormaatVoor` extracted uit `zending-printset.tsx` zodat single + bulk dezelfde SSCC- en label-formaat-logica hergebruiken. Zending-printset is daarmee ook beknopter.
- **[`use-zendingen.ts`](../frontend/src/modules/logistiek/hooks/use-zendingen.ts)** — Nieuwe `useZendingPrintSets(nrs)` op basis van TanStack `useQueries`, met `combine` zodat de page één status (`isLoading`, `hasError`, `data`) ziet i.p.v. een array van resultaten.
- **[`pick-week-sectie.tsx`](../frontend/src/modules/magazijn/components/pick-week-sectie.tsx)** — `<BulkVerzendsetButton>` rechts in de klant-cluster-header (bij 2+ orders) en in de land-header (alleen als toggle "Groeperen op land" aan staat).
- **[`router.tsx`](../frontend/src/router.tsx)** — `logistiek/printset/bulk` toegevoegd vóór `logistiek/:zending_nr` om matching-conflict te vermijden.
- _Waarom_: één klant verzamelt vaak meerdere orders in dezelfde week (samenvoegen-vóór-verzenden bespaart vrachtkosten). Door op cluster-niveau te kunnen printen vermijdt de magazijnier 5× klikken + 5× navigeren + 5× print-dialoog. Het bulk-document gebruikt dezelfde stickers als de single-flow, dus geen aparte template-code.

## 2026-05-07 — Verzendregels: land-eerst weergave i.p.v. platte regellijst

De gegroepeerde dialog (vorige iteratie) was nog steeds te complex voor wat in de praktijk een eenvoudige routing-tabel is: "naar dit land sturen we via deze vervoerder". De gebruiker beschreef het mentale model zelf als "welke partijen leveren aan welk land". De UI is nu gestructureerd om dat model te spiegelen.

- **[`verzendregels-sectie.tsx`](../frontend/src/modules/logistiek/components/verzendregels-sectie.tsx)** — Volledig herschreven naar **land-eerst lijst**. Regels worden gegroepeerd per land (een regel met `conditie.land=['NL','BE']` verschijnt onder zowel NL als BE — geen DB-verandering, alleen weergave). Elk land-blok heeft vlag-emoji + Nederlandse naam + ISO-code + eigen "+ Regel"-knop. Onder de landenblokken staat "Algemeen (alle landen)" voor regels zonder land-conditie. Bovenaan een "+ Land toevoegen"-knop met een inline ISO-input (geen aparte dialog). Vaste sorteervolgorde voor frequente landen: NL, BE, DE, FR, LU, AT, CH; overige alfabetisch.
- **Regelweergave** — Eén leesbare zin per regel: `als rol-lengte ≤ 130 cm → DPD (internationaal)`. Filter-tekst wordt gebouwd uit aanwezige condities; minimal-display als de regel alleen een vervoerder heeft (`→ PostNL`). Toggle/edit/delete als compacte iconen rechts.
- **[`verzendregel-dialog.tsx`](../frontend/src/modules/logistiek/components/verzendregel-dialog.tsx)** — Vereenvoudigd: geen aparte fieldsets meer, gewoon plat formulier met land/vervoerder/service als hoofdvelden, gewicht en rol-lengte als 2x2 raster, en een collapsable "Geavanceerd" sectie voor inkoopgroep/debiteur. Nieuwe prop `prefillLand` zodat de "+ Regel"-knop per land het land-veld al invult.
- **[`land-vlag.ts`](../frontend/src/lib/utils/land-vlag.ts)** — `iso2NaarNaam(iso2)` toegevoegd: ISO-2 → Nederlandse landnaam (NL→Nederland, DE→Duitsland, …) op basis van een hardcoded map rond Karpi's afzetgebied. Zelfde set landen als de bestaande `NAAM_NAAR_ISO2` reverse-mapping.
- _Waarom_: gebruiker werkt vanuit de bestemming, niet vanuit de vervoerder. "Naar Duitsland sturen we DPD bij kleine rollen, Rhenus bij grote" leest natuurlijker dan "regel 10 prio DE+lengte≥131, regel 20 prio DE+lengte≤130". DB en evaluator zijn ongewijzigd — alleen de presentatie.

## 2026-05-07 — Verzendregels: dialog en tabel gegroepeerd op 3 hoofdcategorieën

De conditievelden in [`verzendregel-dialog.tsx`](../frontend/src/modules/logistiek/components/verzendregel-dialog.tsx) lagen door elkaar in één rooster — Land naast Inkoopgroep naast Kleinste-zijde. Voor de gebruiker zijn er feitelijk drie hoofdassen waarop een vervoerder gekozen wordt: **bestemming (land), gewicht, en tapijt-rol-lengte**. Klant- en inkoopgroep-targeting zijn uitzonderingen, geen hoofdcategorieën.

- **[`verzendregel-dialog.tsx`](../frontend/src/modules/logistiek/components/verzendregel-dialog.tsx)** — Conditievelden gegroepeerd in vier `<fieldset>`'s met categorie-icoon en korte uitleg: **Bestemming** (Land), **Gewicht** (zending min/max), **Tapijt-afmeting** (rol-lengte min/max — sub-uitleg dat dit `LEAST(lengte, breedte)` per regel is, MAX over de zending), **Geavanceerd** (Inkoopgroep, Debiteur-nrs). De DB-kolommen blijven `kleinste_zijde_cm_min/max` — alleen de UI-labels heten nu "Min/Max rol-lengte (cm)" omdat dat is wat de gebruiker fysiek ziet bij het oprollen.
- **[`verzendregels-sectie.tsx`](../frontend/src/modules/logistiek/components/verzendregels-sectie.tsx)** — De chip-rij in de tabel groepeert per categorie in één gekleurde pill: sky=bestemming, amber=gewicht, emerald=lengte, slate=geavanceerd. Min en max van dezelfde categorie staan nu samen (`Gewicht ≥ 30 kg · ≤ 50 kg`) in plaats van als losse chips, wat de regel sneller leesbaar maakt.
- _Waarom_: gebruiker omschreef de keuze-logica zelf als "land, gewicht, lengte" — de UI moet die mentale model spiegelen, niet alle conditievelden gelijk behandelen.

## 2026-05-07 — Verzendregels centraal beheerd op vervoerders-overzicht

De verzendregels (mig 208) stonden tot nu toe als sub-sectie op de **detailpagina van elke vervoerder**. Dat dwong de gebruiker om eerst een vervoerder te kiezen voordat hij een regel kon toevoegen, terwijl de mentale modellen omgekeerd is: je begint vanuit een conditie ("Duitsland >130cm") en kiest dáárbij een vervoerder. Eén centraal regelboek over alle vervoerders heen leest ook beter — de prio-volgorde is immers globaal.

- **[`verzendregels-sectie.tsx`](../frontend/src/modules/logistiek/components/verzendregels-sectie.tsx)** — Herschreven naar centrale weergave: gebruikt `useAlleVerzendregels()`, kreeg een nieuwe kolom **Vervoerder** (display-naam + code, inactief-marker) en is niet langer afhankelijk van een `vervoerderCode` prop. Neemt enkel de `Vervoerder[]`-lijst aan om dropdown + display-namen te resolven.
- **[`verzendregel-dialog.tsx`](../frontend/src/modules/logistiek/components/verzendregel-dialog.tsx)** — Vervoerder is nu een **veld in het formulier** (eerste rij, dropdown met actieve vervoerders). Bij wisselen van vervoerder reset het service-code-veld zodat je niet per ongeluk een service van vervoerder-A bij vervoerder-B opslaat. De `vervoerderCode` + `beschikbareServiceCodes` props zijn vervangen door één `vervoerders: Vervoerder[]`.
- **[`vervoerders-overzicht.tsx`](../frontend/src/modules/logistiek/pages/vervoerders-overzicht.tsx)** — Toont de `VerzendregelsSectie` direct onder de vervoerderstabel, met `vervoerders`-lijst doorgegeven.
- **[`vervoerder-detail.tsx`](../frontend/src/modules/logistiek/pages/vervoerder-detail.tsx)** — `VerzendregelsSectie`-import + render verwijderd; detailpagina richt zich nu enkel op vervoerder-eigen instellingen (API/print, contact, tarieven, statistieken, recente zendingen).
- **[`use-verzendregels.ts`](../frontend/src/modules/logistiek/hooks/use-verzendregels.ts)** — `invalidateVerzendregels` invalideert nu de parent-key `['logistiek','verzendregels']` (raakt zowel `'all'` als per-vervoerder caches in één klap). Mutaties (create/update/delete) hoeven geen `vervoerderCode` meer mee te geven.
- _Waarom_: gebruiker wilde één plek om alle regels te zien en te beheren — "boven 30 kg → Rhenus", "NL → PostNL", etc. — zonder eerst per vervoerder te navigeren. De centrale lijst maakt prio-conflicten tussen vervoerders ook direct zichtbaar.

## 2026-05-07 — Pick & Ship: klant-clustering + optionele land-groepering binnen pick-week

Binnen één pick-week-tab wil de magazijnier (a) altijd alle orders naar dezelfde klant naast elkaar zien, en (b) optioneel een extra split per land kunnen maken voor magazijniers die op landniveau plannen (bv. eerst alle DE-orders door één vervoerder).

- **[`groeperen.ts`](../frontend/src/modules/magazijn/lib/groeperen.ts)** _(nieuw)_ — Pure helpers `clusterOrdersOpKlant(orders)` en `groepeerOrdersOpLand(orders)`. Klant-clustering = sorteer op `(klant_naam, order_nr)` en bundel aaneengesloten dezelfde-debiteur-orders. Land-groepering = split eerst op `landNaarIso2(afl_land)`, daarna klant-clusteren binnen elk land. Onbekende landen sorteren achteraan.
- **[`pick-week-sectie.tsx`](../frontend/src/modules/magazijn/components/pick-week-sectie.tsx)** _(nieuw)_ — Verhuist de sectie-render uit `pick-overview.tsx`. Bij toggle-uit: één "all"-bucket; bij toggle-aan: één bucket per land met een vlag-emoji header. Klant-clusters van 2+ orders krijgen een lichte wrapper met klantnaam + telling; single-order = standalone card.
- **[`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)** — Toggle-chip "Groeperen op land" naast de week-tabs (default uit). De page levert alleen `orders` per pick-week-groep aan `<PickWeekSectie>` — render-logica zit nu daar.
- **Tests** — [`groeperen.test.ts`](../frontend/src/modules/magazijn/lib/__tests__/groeperen.test.ts) dekt cluster-aaneengeslotenheid, alfabetische sortering, ISO-2-normalisatie ("Nederland" → NL), en onbekend-land-fallback.
- _Waarom_: meerdere orders naar één klant samen behandelen scheelt verzendkosten en pakwerk. De toggle staat default uit zodat het standaard-gedrag (klant-clustering) niet onnodig nesting toevoegt; magazijniers die per route plannen kunnen 'm aanzetten.

## 2026-05-07 — Pick & Ship: tabs per pick-week (5 weken vooruit + Later)

De Pick & Ship-overview had twee tabs ("Deze week" / "Later") — die bundelden te grof. Voor planning op de werkvloer wil de magazijnier per pick-week kunnen schakelen.

- **[`buckets.ts`](../frontend/src/modules/magazijn/lib/buckets.ts)** — `BucketKey` is nu `'wk_1' | 'wk_2' | 'wk_3' | 'wk_4' | 'wk_5' | 'later'` (relatieve offsets t.o.v. de huidige pick-week). `bucketVoor()` gebruikt `verzendWeekDiff` uit het orderdomein-seam: ship_diff ≤ 1 → wk_1 (huidige pick-week, incl. achterstallig), ship_diff 2..5 → wk_2..wk_5, ≥ 6 of geen datum → later. Nieuwe helper `genereerWeekTabs(vandaag)` labelt op **pick-week**: vandaag (week 19) → tabs "Week 19", "Week 20", …, "Week 23", "Later".
- **[`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)** — Tabs gerenderd uit `genereerWeekTabs`; default-tab is `wk_1` (huidige pick-week). Sectie-koppen binnen een tab tonen `Te picken in week N · verzendweek M`, zodat de magazijnier zowel zijn eigen pick-moment als de uitgaande beloofde verzendweek ziet.
- **[`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)** — `PickShipStats.per_bucket` initialisatie uitgebreid naar de zes nieuwe sleutels. "Te picken deze week"-statkaart gebruikt nu `per_bucket.wk_1`.
- **Tests** — [`buckets.test.ts`](../frontend/src/modules/magazijn/lib/__tests__/buckets.test.ts) gemodelleerd op de nieuwe sleutels (12 cases voor `bucketVoor`, 5 voor `genereerWeekTabs`, jaarwisseling gedekt).
- _Waarom_: pick-werk wordt door de magazijnier in de eigen werkweek gepland — niet de verzendweek. Tab-label `Week 19` betekent "deze week pick ik dit", de bijbehorende sticker-pill `Verzendweek 20` blijft als referentie naar de leverbelofte.

## 2026-05-07 — Pick & Ship: ordertype-badge + landvlag op pickregel

De samenvattingsrij van [`OrderPickCard`](../frontend/src/modules/magazijn/components/order-pick-card.tsx) miste twee informatiestukken die de magazijnier in één oogopslag wil zien: of de order maatwerk, standaard, of een combinatie is, en naar welk land hij moet. Voorheen stond er alleen een grijze ISO-2-tekstpill (bv. "DE") en moest de gebruiker de regels uitklappen om het type te zien.

- **[`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)** — Naast de klantnaam staat nu een gekleurde type-pill: `Maatwerk` (oranje, alle regels op maat), `STD` (blauw, alle regels standaard) of `Combi` (paars, gemengd). Afgeleid uit `regels[].is_maatwerk` via nieuwe helper `bepaalOrderType`. De land-pill toont een vlag-emoji vóór de ISO-2-code (🇩🇪 DE, 🇧🇪 BE, …); het mobiele-fallback-blok toont dezelfde vlag.
- **[`lib/utils/land-vlag.ts`](../frontend/src/lib/utils/land-vlag.ts)** _(nieuw)_ — Centrale util `landNaarIso2` + `iso2NaarVlag` + combinatie `landNaarVlag`. Normaliseert zowel ISO-2-codes als volledige landnamen (NL/EN, met diakritiek-strip) naar een ISO-2-code en levert het regional-indicator vlag-emoji. Geen runtime-data — pure unicode-aritmetiek + kleine landnaam-mapping.
- _Waarom_: pickronde wordt sneller wanneer type en bestemming meteen zichtbaar zijn — magazijnier kan op type-pill scannen om alle maatwerk-orders eerst af te handelen, en de vlag voorkomt verwarring bij export-orders waar de werkwijze (douane-papieren, andere vervoerder) afwijkt.

## 2026-05-07 — Pick & Ship: vervoerder duidelijker zichtbaar in pickregel

De vervoerder-pill op de samenvattingsrij van [`OrderPickCard`](../frontend/src/modules/magazijn/components/order-pick-card.tsx) was een onopvallende mini-badge (10px, uppercase, alleen een gekleurd bolletje). Voor de magazijnier die per order moet weten welke etiket-flow aan de beurt is, was dat te subtiel.

- **[`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx)** — Pill vergroot van `text-[10px]` uppercase naar `text-xs` mixed-case, padding van `px-2 py-0.5` naar `px-2.5 py-1`, het kleurpunt-bolletje vervangen door een Truck-icoon (12px). De "Afhalen"-variant kreeg dezelfde behandeling voor visuele consistentie.
- **[`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)** — De verzendweek-indicator (eerder ook `Truck`) wisselt naar `CalendarDays` zodat het Truck-icoon nu eenduidig "vervoerder" betekent op de regel.
- _Waarom_: vervoerder is per pickregel een hoofdactie (bepaalt welke labels/zending-flow loopt), niet metadata — verdient daarom dezelfde visuele prominentie als de andere actie-elementen op de rij.

## 2026-05-07 — Pickronde-flow (mig 211)

**Beslissing:** [ADR-0003](adr/0003-pickronde-als-deepening-van-magazijn-module.md)
**Plan:** [docs/superpowers/plans/2026-05-07-pickronde-implementatie.md](superpowers/plans/2026-05-07-pickronde-implementatie.md)

- Migratie 211: enum `pick_uitkomst` + 3 kolommen op `zending_colli`. Drie nieuwe RPC's: `start_pickronde`, `markeer_colli_niet_gevonden`, `voltooi_pickronde`.
- `create_zending_voor_order` is nu alias voor `start_pickronde`. Zending start in status `Picken`, niet meer direct in `Klaar voor verzending`.
- Bestaande HST-/EDI-trigger (`trg_zending_klaar_voor_verzending`) ongemoeid — vuurt nu pas op echte voltooi-moment.
- Frontend: nieuwe `<ColliPickVinkjes>` + `<VoltooiPickrondeKnop>` op printset-pagina; compact `<PickProblemenBanner>` bovenaan Pick & Ship-pagina (uitklapbaar, alleen zichtbaar als er problemen openstaan).
- Zendingen-overzicht verbergt lopende Pickrondes default (filter "Picken" laat ze zien).
- _Waarom_: gebruiker zag zendingen op `Klaar voor verzending` voordat het tapijt fysiek van de plank was — door bundeling van "stickers printen" met "zending creëren". Pickronde scheidt deze twee momenten.

## 2026-05-07 — Mig 212: `update_order_with_lines` UPSERT i.p.v. delete-and-recreate

Een verzendweek (of welke header-veld ook) wijzigen op een order waar al een zending of factuur aan hangt, faalde met:

```
update or delete on table "order_regels" violates foreign key constraint
"zending_regels_order_regel_id_fkey" on table "zending_regels"
```

Oorzaak: de RPC deed `DELETE FROM order_regels WHERE order_id = p_order_id` + volledige re-INSERT van álle regels — ook bij header-only wijzigingen. Daardoor kreeg elke "ongewijzigde" regel een nieuwe `id`, wat naast de FK-fout ook stilletjes de zending-↔ orderregel-koppeling brak.

- **Mig 212** ([`212_update_order_with_lines_upsert.sql`](../supabase/migrations/212_update_order_with_lines_upsert.sql)) — RPC herschreven naar drie stappen: (1) DELETE regels die niet meer in `p_regels` staan, (2) UPDATE bestaande regels gematcht op `id`, (3) INSERT regels zonder `id`. Header-only wijzigingen voeren nu uitsluitend stap 2 als no-op-UPDATEs uit. Echte regel-verwijderingen vallen nog steeds onder de FK-policy van zending_regels/factuur_regels — dat is correct, want een regel verwijderen die al verzonden of gefactureerd is hoort gewoon te falen.
- **Frontend ongewijzigd** — `updateOrderWithLines` in [`order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts) stuurt al `id` mee per regel, dus de RPC-aanroep is hetzelfde gebleven.

## 2026-05-07 — Order-form: "Afleverdatum" + "Week" velden vervangen door één "Verzendweek"

Karpi communiceert leverbeloftes als ISO-week, niet als specifieke dag. De order-form toonde echter beide: een datumveld (afleverdatum, berekend uit orderdatum + werkdagen/weken) én een afgeleid weeknummer-veld. Dat suggereerde dat de dag relevant was voor de gebruiker — wat niet zo is. Nu staat er één veld: **Verzendweek**.

- **Order-form** ([`order-form.tsx`](../frontend/src/components/orders/order-form.tsx)) — Dual-veld vervangen door nieuwe `VerzendweekField`-component met HTML5 `<input type="week">` (native ISO-week-picker, correct rond jaarwisseling). Boven het veld staat altijd "Vandaag: Wk N · YYYY" zodat de orderaannemer direct kan vergelijken; onder het veld staat de gekozen week + relatief label ("deze week" / "volgende week" / "over 3 weken") + pick-week. Het orderdetail-header (verzonden orders inclusief) toont hetzelfde relatief-label achter de week.
- **Onderliggende kolommen blijven** — `orders.afleverdatum` (DATE, vrijdag van de gekozen week) en `orders.week` (TEXT) blijven gevuld. Geen migratie nodig: alle bestaande logica (mig 153 IO-claim sync, pick & ship bucket, sortering, levertijd-berekening) werkt ongewijzigd door.
- **Centrale helpers** ([`lib/orders/verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts)) — Twee nieuwe functies: `verzendWeekIsoString(iso)` (datum → "2026-W21" voor `<input type="week">`) en `verzendWeekStringToDatum(weekStr)` (week-string → vrijdag-ISO-datum). Ronde-reis test verifieert idempotentie. Lokale `getISOWeek` in `order-form.tsx` is teruggebracht tot een dunne wrapper rond `verzendWeekVoor` om duplicate ISO-week-aritmetiek te elimineren.
- **Order-detailheader** ([`order-header.tsx`](../frontend/src/components/orders/order-header.tsx)) — "Afleverdatum: 21-05-2026" → "Verzendweek: Wk 21 · 2026".
- **Orders-overzichtstabel** ([`orders-table.tsx`](../frontend/src/components/orders/orders-table.tsx)) — Kolom "Leverdatum" → "Verzendweek". Cel toont "Wk 21 · 2026" met de exacte datum als tooltip; sorteert nog steeds op `afleverdatum` (zelfde sleutel, week-volgorde is identiek aan datum-volgorde).
- **Pick & ship**: groepskoppen herontworpen. Voorheen was elke groep gelabeld "Verzendweek N" — niet actiegericht. Nu staat boven elke groep "Te picken deze week" met daarnaast twee chips: een teal "Verzendweek N"-chip én, als de pick-week al voorbij is (verzendweek == huidige week), een rose "Achterstallig"-marker met tooltip. Sectie-tekst krijgt rose tint bij achterstallig. De huidige ISO-week staat rechtsboven in de page header ("Vandaag: Wk N · YYYY") zodat de magazijnier altijd weet hoe nu zich verhoudt tot de groepen. Bron: [`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx) + nieuwe helpers `pickStatusVoor`, `pickWeekVoor` in [`lib/orders/verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts). De `bucketVoor`-logica zelf is ongewijzigd: orders met afleverdatum < maandag-over-volgende-week vallen in `'deze_week'`, dus verzendweek N → pickbaar in week N-1.

## 2026-05-07 — Vervoerders-overzicht: "Nieuwe vervoerder"-knop + dialog

Voorheen waren vervoerders alleen via SQL-migraties aan te maken (mig 170 / 207). Met de regel-evaluator (mig 208/210) heeft het zin om dit ook in-app te kunnen — handelspartners kunnen verschillen per markt en hoeven niet altijd een nieuwe migratie waard.

- **Knop in [`vervoerders-overzicht.tsx`](../frontend/src/modules/logistiek/pages/vervoerders-overzicht.tsx)** — "Nieuwe vervoerder" rechtsboven, opent [`vervoerder-create-dialog.tsx`](../frontend/src/modules/logistiek/components/vervoerder-create-dialog.tsx). Na aanmaken navigeert de UI direct naar de detailpagina zodat de gebruiker API-/print-instellingen, contact en verzendregels kan invullen.
- **Minimale create-input** — `code` (PK, genormaliseerd naar `[a-z0-9_]`), `display_naam`, `type` (api/edi/print), optionele notities. `actief` blijft FALSE (DB-default) — pas activeren ná configuratie.
- **Query + hook** — `createVervoerder` in [`queries/vervoerders.ts`](../frontend/src/modules/logistiek/queries/vervoerders.ts), `useCreateVervoerder` in [`hooks/use-vervoerders.ts`](../frontend/src/modules/logistiek/hooks/use-vervoerders.ts). Invalideert `vervoerders'-list`, `vervoerder-stats` en de oude lichtgewicht `'vervoerders'`-key zodat dropdowns ook updaten.

## 2026-05-07 — Pick & Ship-overzicht: compacte 1-regel pakbon-rij + inline vervoerder-keuze

Het pick & ship-overzicht is herontworpen van expanderende kaarten naar een compacte rijenlijst — één pakbon per regel. Elke rij toont op één lijn: ordernummer + status, klantnaam, totaal-m², totaal-gewicht (kg), land + bestemming, verzendweek, vervoerder en de Verzendset-knop. Klikken klapt de regelsdetails uit (productkolom, pickbaarheid, locatie) — wat voorheen direct zichtbaar was.

- **Type-uitbreiding** ([`types.ts`](../frontend/src/modules/magazijn/lib/types.ts)) — `PickShipOrder` krijgt `afl_adres`, `afl_postcode`, `afl_land` en `totaal_gewicht_kg` zodat de samenvattingsrij land + kg kan tonen zonder extra fetches.
- **Pickbaarheid-query** ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)) — orders-select uitgebreid naar `afl_adres, afl_postcode, afl_land`. Nieuwe helper `fetchTotaalGewichtPerOrder` somt `gewicht_kg × orderaantal` per order (excl. pseudo-regel `VERZEND`); resultaat wordt na de regel-fetch in `PickShipOrder.totaal_gewicht_kg` geschreven. Indicatief op P&S; definitief gewicht zet `create_zending_voor_order` op de zending zelf (mig 206).
- **Compacte pick-rij** ([`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)) — herschreven naar 1-regel-layout. Pickbaarheid-tabel met regels staat in een inklapbaar paneel (default dicht). De rij is toetsenbord-bedienbaar (Enter/Space toggelt).
- **Vervoerder-inline-selector** ([`vervoerder-inline-select.tsx`](../frontend/src/modules/logistiek/components/vervoerder-inline-select.tsx)) — pill-knop die per pakbon de actieve vervoerder toont (klant-config wint, anders globaal-actief) en bij klik een dropdown opent waarin de gebruiker de **klant**-vervoerder kan wijzigen. Schrijft naar `klant_vervoerder_config` (= zelfde tabel als klant-detail-tab); telt alleen voor toekomstige zendingen, bestaande zendingen blijven ongewijzigd.
- **Contract-test** ([`magazijn-pickbaarheid.contract.test.ts`](../frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts)) — uitgebreid met `order_regels`-respons voor de gewicht-aggregaat-fetch in elk van de 4 scenario's; nieuwe assertie `expect(order.totaal_gewicht_kg).toBe(16)` in scenario 1.

## 2026-05-07 — Mig 207–210: DPD + verzendregels + per-colli SSCC

DPD als nieuwe vervoerder, gekozen via een regel-evaluator op zending-niveau. Stickers worden lokaal in RugFlow gerenderd op 80×150mm (Zebra ZT230 thermisch) — geen externe API-koppeling. Aanleiding: Karpi gebruikt vandaag DPD voor pakketzendingen (≤30kg) en wil de DPD-portaal-flow vervangen door directe sticker-print uit RugFlow.

- **Mig 207** — `vervoerders.type` verbreed van `('api','edi')` naar `('api','edi','print')`. Print-config-velden toegevoegd: `printer_naam`, `printer_ip`, `label_breedte_mm`, `label_hoogte_mm`, `service_codes` (TEXT[]). DPD-record geseed (initieel inactief).
- **Mig 208** — nieuwe tabel `vervoerder_selectie_regels` met JSONB-conditie. Conditie-shape V1: `land`, `kleinste_zijde_cm_min/max`, `gewicht_kg_min/max`, `debiteur_nrs`, `inkoopgroep_codes`. Geseed met 2 voorbeeld-regels: Rhenus naar DE >130cm en DPD naar DE ≤130cm. *Kleinste zijde* = `LEAST(lengte, breedte)` per orderregel; voor de zending = MAX over alle regels.
- **Mig 209** — nieuwe tabel `zending_colli` (1 rij per fysieke colli) + GS1 SSCC-generator (`genereer_sscc`, 18 cijfers, Mod-10 check). RPC `genereer_zending_colli(zending_id)` splitst zending-regels in 1-tapijt-per-colli rijen. V1: strikt 1:1; multi-tapijt-per-colli komt later.
- **Mig 210** — `selecteer_vervoerder_voor_zending` herschreven als regel-evaluator (eerste matchende regel wint, prio ASC). Returnt nu ook `gekozen_service_code`. `zendingen.service_code` toegevoegd. Switch-RPC `enqueue_zending_naar_vervoerder` uitgebreid met `type='print'`-tak die alleen `genereer_zending_colli` aanroept zonder externe dispatch.
- **Frontend** — vervoerder-detail ([`vervoerder-detail.tsx`](../frontend/src/modules/logistiek/pages/vervoerder-detail.tsx)) krijgt **Verzendregels-sectie** ([`verzendregels-sectie.tsx`](../frontend/src/modules/logistiek/components/verzendregels-sectie.tsx) + dialog) en print-config-velden (printer-naam, label-formaat, service-codes). Nieuwe DPD-sticker ([`dpd-shipping-label.tsx`](../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx), 80×150mm) met layout volgens DPD-portaal-template. Printset-page ([`zending-printset.tsx`](../frontend/src/modules/logistiek/pages/zending-printset.tsx)) kiest sticker-component en `@page`-formaat op basis van `vervoerders.type` en `label_*_mm`.
- **Verzendset-knop** — losgekoppeld van "exact 1 actieve vervoerder"-aanname; checkt nu alleen of er minstens één vervoerder actief is (server-side regel-evaluator kiest de juiste).

## 2026-05-07 — Pakbon + sticker filteren VERZEND ook via order_regels

Vervolg op mig 206. De UI-filter op verzendkosten-regels keek alleen naar `zending_regels.artikelnr`. Bij oudere zendingen (en zendingen aangemaakt via paden waarin de snapshot leeg gebleven is) staat die NULL en zit het 'VERZEND'-label alleen op `order_regels.artikelnr` — gevolg: een lege/spook-sticker met "Verzendkosten" naast de echte tapijt-sticker.

- **Nieuwe helper** [`isShippingRegel`](../frontend/src/modules/logistiek/lib/is-shipping-regel.ts) — predikaat dat zowel `zending_regels.artikelnr` als de gekoppelde `order_regels.artikelnr` toetst tegen `SHIPPING_PRODUCT_ID` ('VERZEND').
- **Pakbon** ([`pakbon-document.tsx`](../frontend/src/modules/logistiek/components/pakbon-document.tsx)) en **stickers** ([`zending-printset.tsx`](../frontend/src/modules/logistiek/pages/zending-printset.tsx)) gebruiken nu beide deze helper.
- **Sticker-padding fix** — `expandLabels` baseert het collo-totaal nu op `expanded.length` i.p.v. `Math.max(zending.aantal_colli, expanded.length, 1)`. Voor pre-mig-206 zendingen telde `aantal_colli` de VERZEND-regel mee; padden naar dat getal genereerde een extra fantoom-sticker.
- **Query-uitbreiding** ([`zendingen.ts`](../frontend/src/modules/logistiek/queries/zendingen.ts)) — `ZendingPrintOrderRegel` krijgt `artikelnr`, en `fetchZendingPrintSet` selecteert dat veld mee zodat de helper z'n fallback-check kan doen.

## 2026-05-07 — Pick & Ship toont Karpi-naam; pakbon + sticker tonen klanteigen + Karpi

Sinds mig 200 wordt op een orderregel de **klanteigen-alias** als `omschrijving` weggeschreven (zodat factuur/EDI de naam tonen die de klant in z'n eigen administratie kent). Dat is goed voor uitgaande documenten, maar verwarrend voor het magazijn — daar werkt iedereen op Karpi's eigen artikel-administratie. Pick & Ship toont nu altijd `producten.omschrijving` (de canonische Karpi-naam); pakbon en verzendsticker tonen beide namen zodat de ontvanger 'm herkent én de retour-/magazijncheck terug kan vallen op de Karpi-bron.

- **Pick & Ship-overzicht** ([`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx) / [`pick-overview.tsx`](../frontend/src/modules/magazijn/pages/pick-overview.tsx)) — productkolom toont alleen nog Karpi-naam.
- **Pickbaarheid-query** ([`pickbaarheid.ts`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts)) — nieuwe `fetchKarpiNamenVoorArtikelen`-helper haalt `producten.omschrijving` per uniek `artikelnr` op (gebatcht in chunks van 200) en wordt als parameter aan `mapPickbaarheidRegel` doorgegeven.
- **Transform** ([`pick-ship-transform.ts`](../frontend/src/modules/magazijn/queries/pick-ship-transform.ts)) — `mapPickbaarheidRegel(r, karpiNaam)` gebruikt de Karpi-naam als primaire bron voor het displayed-product-veld; valt terug op `omschrijving` (en daarna `kwaliteit_code + kleur_code`) als de producten-join leeg is.
- **Pakbon** ([`pakbon-document.tsx`](../frontend/src/modules/logistiek/components/pakbon-document.tsx)) — artikelregel toont eerst de klanteigen-naam en daaronder, alleen als die afwijkt, een grijze `Karpi: <naam>`-regel.
- **Verzendsticker** ([`shipping-label.tsx`](../frontend/src/modules/logistiek/components/shipping-label.tsx)) — zelfde patroon: klantnaam (groot) + grijze `Karpi: <naam>`-subregel als ze verschillen.
- **Tests** — bestaande contract-test in [`magazijn-pickbaarheid.contract.test.ts`](../frontend/src/modules/magazijn/__tests__/magazijn-pickbaarheid.contract.test.ts) uitgebreid met `producten`-fixture en assertie dat `regel.product` de Karpi-naam is, niet de orderregel-omschrijving.

## 2026-05-07 — Mig 206: VERZEND-regel buiten zending houden

Vervolg op de pakbon-herwerking. De auto-toegevoegde verzendkosten-regel (`artikelnr='VERZEND'`, zie [`shipping.ts`](../frontend/src/lib/constants/shipping.ts)) is een factuurregel — niet een fysiek collo. Vóór deze migratie kwam die regel mee in `zending_regels`, in `aantal_colli`, en in elke pakbon/sticker-render.

- **Migration 206** ([`206_zending_skip_verzendkosten.sql`](../supabase/migrations/206_zending_skip_verzendkosten.sql)) — `create_zending_voor_order(BIGINT)` vult `aantal_colli`, `totaal_gewicht_kg`, en de `zending_regels`-INSERT nu met `AND COALESCE(ore.artikelnr, '') <> 'VERZEND'`. Bestaande zendingen worden niet retroactief opgeschoond. Idempotent CREATE OR REPLACE + `NOTIFY pgrst`.
- **Pakbon-component** ([`pakbon-document.tsx`](../frontend/src/modules/logistiek/components/pakbon-document.tsx)) — defensieve UI-side filter `r.artikelnr !== SHIPPING_PRODUCT_ID` voor oude zendingen die vóór mig 206 zijn aangemaakt.
- **Stickers/colli-expand** ([`zending-printset.tsx`](../frontend/src/modules/logistiek/pages/zending-printset.tsx)) — zelfde filter in `expandLabels` zodat er geen "verzendkosten"-sticker meer wordt geprint voor oude zendingen.
- **Schema-doc** — kolomtoelichtingen op `zendingen.aantal_colli` en `zendingen.totaal_gewicht_kg` bijgewerkt.

## 2026-05-07 — Pick & Ship: 2 filter-tabs + groeperen per verzendweek (orderdomein-seam)

Pick & Ship-overzicht is gestript naar 2 tabs (`Deze week` / `Later`) en groepeert orders binnen het tabblad per ISO-verzendweek. Vuistregel: picken gebeurt altijd in de week vóór de verzendweek, dus `Deze week` toont verzendweken ≤ huidige_week + 1 (incl. achterstallig) en `Later` alles vanaf huidige_week + 2 plus orders zonder afleverdatum.

**Nieuw orderdomein-seam.** [`lib/orders/verzendweek.ts`](../frontend/src/lib/orders/verzendweek.ts) is de enige plek waar `orders.afleverdatum` → verzendweek wordt vertaald. Karpi-context: een afleverdatum 06-05 betekent semantisch "verzonden in week 19", niet "geleverd op de zesde". Magazijn (pick & ship), logistiek (zendingen) en order-UI consumeren dezelfde helpers (`verzendWeekVoor`, `verzendWeekSleutel`, `verzendWeekLabel` → "Verzendweek 19", `verzendWeekKort` → "Wk 19", plus `isoWeek` / `isoMaandag`). Verandert de mapping ooit (bv. shift voor specifieke vervoerders), dan gebeurt dat hier en nergens anders.

- [`BucketKey`](../frontend/src/modules/magazijn/lib/types.ts) gereduceerd van 7 naar 2 waardes (`'deze_week' | 'later'`); `PickShipOrder` krijgt `verzend_week_sleutel` (`YYYY-Www`) + `verzend_week_label` (`Verzendweek 19`) + `verzend_week_kort` (`Wk 19`) voor stabiele groepering en card-display.
- [`buckets.ts`](../frontend/src/modules/magazijn/lib/buckets.ts) bevat nu alleen nog magazijn-specifieke `bucketVoor` (pick-bucket-vraag) + re-exports uit de seam, zodat module-consumers één import-locatie hebben.
- [`MagazijnOverviewPage`](../frontend/src/modules/magazijn/pages/pick-overview.tsx) toont 2 tabs en rendert per actieve tab een serie `Verzendweek N`-secties (gesorteerd op verzendweek-sleutel oplopend). Stat-kaarten geüpdatet naar `Open orders` / `Te picken deze week` / `Later`. Standaard-tab is `Deze week`. Header-tekst praat over "verzendweek" i.p.v. "afleverdatum".
- [`OrderPickCard`](../frontend/src/modules/magazijn/components/order-pick-card.tsx) toont rechtsboven een truck-icoon + "Wk 19" i.p.v. de losse afleverdatum, met tooltip dat dit de verzendweek is (= week ván de afleverdatum).
- [`fetchPickShipStats`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts) `per_bucket` heeft nu alleen `deze_week` + `later`.
- Tests: 5 in [`buckets.test.ts`](../frontend/src/modules/magazijn/lib/__tests__/buckets.test.ts) (incl. jaarwisseling-edgecase) + 11 in nieuwe [`verzendweek.test.ts`](../frontend/src/lib/orders/__tests__/verzendweek.test.ts) (ISO-week, label-formats, zero-padding, null-fallback).

## 2026-05-06 — Pakbon-layout omgezet naar legacy Karpi-factuurstructuur

De pakbon vanuit Pick & Ship volgt nu de opbouw van de oude Karpi-factuur (zoals gebruikt op MITS-systeem) in plaats van de generieke "PAKBON"-template. Magazijn en chauffeurs zijn deze layout gewend; verschil met factuur is dat prijzen weg blijven en dat het document "Pakbonnummer/Pakbondatum" toont.

- [`PakbonDocument`](../frontend/src/modules/logistiek/components/pakbon-document.tsx) compleet herschreven. Nieuwe opbouw: KARPI-headertekst links, bedrijfsadres (uit `app_config.bedrijfsgegevens`) rechts; klantblok met factuuradres + meta-rij (`Uw debiteurnummer`, `Pakbonnummer`, `Pakbondatum`, `Vertegenwoordiger`); gestreepte tabel-divider met kolommen `Artikel | Aantal | Eh | Omschrijving`; per-order sub-blok met `Ons Ordernummer / Uw Referentie (incl. WK) / Afleveradres`; totaalregel `Totaal m2 + Totaal gewicht (kg)` direct onder de regels; dubbele streepjes-footer met KvK / BTW / IBAN / BIC + betalingscondities-tekst.
- m²-berekening in [`oppervlakM2PerStuk`](../frontend/src/modules/logistiek/components/pakbon-document.tsx) is vorm-aware: maatwerk gebruikt `maatwerk_oppervlak_m2` (of l×b/10000 fallback), vaste producten vallen terug op `producten.lengte_cm/breedte_cm/vorm` (rond → π·r², rest → l·b). Past bij de gewicht-resolver van mig 185/188.
- [`fetchZendingPrintSet`](../frontend/src/modules/logistiek/queries/zendingen.ts) selecteert nu naast de bestaande velden ook `orders.fact_*`, `orders.afl_naam_2`, `orders.week`, `orders.afhalen`, `orders.vertegenw_code` + `vertegenwoordigers(code, naam)`-join, en op `producten` `lengte_cm / breedte_cm / vorm` plus `order_regels.maatwerk_oppervlak_m2` voor de m²-berekening.
- Bedrijfsgegevens worden via `useQuery({queryKey: ['bedrijfsgegevens']})` met 5-min staleTime in het pakbon-component opgehaald — geen extra prop-drilling vanuit `ZendingPrintSetPage` nodig.

## 2026-05-06 — Mig 205: afhalen door pick & ship + zending-flow respecteren

Vervolg op mig 204 — de afhalen-vlag wordt nu ook erkend in de logistieke keten.

- **Migration 205** ([`205_afhalen_skip_vervoerder.sql`](../supabase/migrations/205_afhalen_skip_vervoerder.sql)) — `enqueue_zending_naar_vervoerder(BIGINT)` leest nu `orders.afhalen` mee in de eerste JOIN en returnt direct `'afhalen_geen_vervoerder'` zodra de vlag aan staat. Geen HST-transportorder, geen verzendstickers. De zending-rij blijft staan voor pakbon en de overgang naar `Verzonden`.
- **Pick & Ship card** ([`order-pick-card.tsx`](../frontend/src/modules/magazijn/components/order-pick-card.tsx)) — afhaal-orders tonen een amber `Afhalen`-tag i.p.v. de `<VervoerderTag>`. `PickShipOrder` (en de onderliggende `OrderHeaderRij`) krijgen het veld `afhalen: boolean`; [`fetchPickShipOrders`](../frontend/src/modules/magazijn/queries/pickbaarheid.ts) selecteert het mee.
- **Verzendset-knop** ([`verzendset-button.tsx`](../frontend/src/modules/logistiek/components/verzendset-button.tsx)) — voor afhaal-orders is een actieve vervoerder geen vereiste meer (de RPC dispatched toch niet). Knop-label wordt **"Afhaalset"** met `PackageCheck`-icon en tooltip "Maak afhaal-zending + pakbon (geen verzendstickers)".
- **Zending-aanmaken-knop** ([`zending-aanmaken-knop.tsx`](../frontend/src/components/orders/zending-aanmaken-knop.tsx)) — zelfde patroon op de order-detail "Klaar voor verzending"-knop: vervoerder-check overgeslagen bij afhalen, label wordt **"Afhaal-zending aanmaken"**. [`OrderDetailPage`](../frontend/src/pages/orders/order-detail.tsx) geeft `order.afhalen` door.

## 2026-05-06 — Mig 204: order afhalen-vlag + handmatig afleveradres in order-form

Twee uitbreidingen op de order-module die buiten de standaard verzend-flow vallen.

- **Afhalen-vlag** ([`204_orders_afhalen.sql`](../supabase/migrations/204_orders_afhalen.sql)) — `orders.afhalen BOOLEAN NOT NULL DEFAULT false`. RPC's `create_order_with_lines` en `update_order_with_lines` lezen nu `p_order/p_header->>'afhalen'` (update muteert alleen als de key in de payload staat, om bestaande callers ongemoeid te laten). `NOTIFY pgrst, 'reload schema'` aan het einde.
- **Checkbox in [`OrderForm`](../frontend/src/components/orders/order-form.tsx)** — "Klant haalt zelf af — verzendkosten vervallen". Toggle roept `handleAfhalenToggle` aan die `applyShippingLogic` re-runt met `afhalenActief=true` zodat de VERZEND-regel onmiddellijk verdwijnt; uit-zetten herstelt de auto-shipping-evaluatie (drempel/gratis_verzending/verzendkosten van debiteur). Bij actief afhalen wordt de [`AddressSelector`](../frontend/src/components/orders/address-selector.tsx) verborgen en verschijnt een amber waarschuwingsblok in [`OrderAddresses`](../frontend/src/components/orders/order-addresses.tsx).
- **Handmatig afleveradres** in [`AddressSelector`](../frontend/src/components/orders/address-selector.tsx) — extra dropdown-optie "+ Nieuw afleveradres invullen…" opent inline een form (naam, adres, postcode, plaats, land) met optionele checkbox **"Opslaan in adresboek voor toekomstige orders"**. Bij opslaan: insert in `afleveradressen` met `adres_nr = max(bestaande)+1` zodat het nieuwe adres meteen in de dropdown verschijnt voor de huidige sessie. Voor losse dropship-orders kan de gebruiker de checkbox uit laten en wordt het adres alleen als snapshot op de order opgeslagen (zelfde gedrag als voorheen voor bestaande adressen).
- **Order-edit + detail** — [`OrderEditPage`](../frontend/src/pages/orders/order-edit.tsx) propageert `order.afhalen` naar de form-state. [`OrderAddresses`](../frontend/src/components/orders/order-addresses.tsx) toont een amber "Afhalen"-badge bovenaan zodra de vlag aan staat.

## 2026-05-06 — Producten-overzicht: afwerking-editor ook voor rol-kwaliteiten + dropdown-clipping fix

Op `/producten` (kwaliteiten-gegroepeerd) bleef de afwerking-editor verborgen voor kwaliteiten zoals VELE die wel actieve rol-producten hebben (bron voor maatwerk-snijden) maar nog geen rij in `maatwerk_m2_prijzen`. Daardoor kon de gebruiker geen standaard-afwerking instellen, en bleef de bandkleur-keuze per kleur ook geblokkeerd. Daarnaast werd het dropdown-menu zelf afgekapt onderaan de tabel.

- [`fetchMaatwerkKwaliteiten`](../frontend/src/lib/supabase/queries/op-maat.ts) en [`fetchMaatwerkKleurenVoorKwaliteit`](../frontend/src/lib/supabase/queries/op-maat.ts) tellen nu naast `maatwerk_m2_prijzen`-rijen ook actieve `producten` met `product_type='rol'` mee. Een rol IS de fysieke maatwerk-bron, dus afwerking + bandkleur instellen heeft daar zin, ook vóór de m²-prijs geseed is. Geen DB-wijziging — twee parallelle SELECTs, client-side union.
- **Dropdown clipping fix** in [`AfwerkingEditor`](../frontend/src/pages/producten/kwaliteiten-grouped-view.tsx): het menu rendert nu via `createPortal` naar `document.body` met `position: fixed`-coördinaten uit `getBoundingClientRect`. De table-wrapper heeft `overflow-hidden` voor de afgeronde hoeken, waardoor het oude `position: absolute`-menu door de cel werd afgekapt zodra de rij onderaan stond. Klapt automatisch naar boven als er onder geen ruimte is, sluit bij scroll/resize zodat de positie niet stale wordt.

## 2026-05-06 — Bulk-verplaatsing van klanten tussen betaalcondities

In de [klanten-modal](../frontend/src/components/instellingen/betaalconditie-klanten-dialog.tsx) op `/instellingen/betaalcondities` zit nu een checkbox-kolom + select-all in de header. Zodra ≥1 klant geselecteerd is verschijnt in de footer een dropdown "Verplaats naar — {andere conditie}" + bevestig-knop. Schrijft via `bulkSetBetaalconditie` (Supabase JS `.update().in('debiteur_nr', […])`) het volledige `"{code} - {naam}"`-formaat naar `debiteuren.betaalconditie` zodat de factuur-RPC ongewijzigd blijft. Confirmation-dialog vóór de schrijfactie. Hook `useBulkSetBetaalconditie` invalidert zowel de betaalcondities-counts als alle klanten-queries zodat de aantallen direct kloppen.

## 2026-05-06 — Mig 203: betaalcondities — dagen herleiden + klanten-modal

Vervolg op mig 202: na de eerste seed bleven sommige condities zonder `dagen` staan omdat de naam-tekst andere notatie gebruikte (bv. afgekortte vormen `30 t.`, `45 d.`). Daarnaast wilde de gebruiker direct vanaf de instellingen-pagina de klantenlijst zien achter een conditie.

- **Migration 203** ([`203_betaalcondities_dagen_en_klanten_rpc.sql`](../supabase/migrations/203_betaalcondities_dagen_en_klanten_rpc.sql)) — UPDATE die `dagen` herleidt voor rijen waar het NULL is, met een cascading regex: volledig woord (`dagen|tage|days|tag|day`) → afgekort met punt (`t\.`/`d\.`) → afgekort zonder punt → leading number-fallback. Eerste match wint per rij. Niet-matchende naam-waarden komen als NOTICE in de migratie-output zodat de gebruiker ze handmatig kan invullen via de UI.
- **RPC `klanten_voor_betaalconditie(code)`** — `STABLE / SECURITY INVOKER`, geeft `(debiteur_nr, naam, plaats, status, betaalconditie)` terug voor alle debiteuren wier `betaalconditie`-veld het format `"{code} - ..."` heeft. Match-logica gespiegeld aan view `betaalcondities_met_aantal_klanten`. `NOTIFY pgrst, 'reload schema'` aan het einde.
- **Modal "Klanten met deze betaalconditie"** — [`BetaalconditieKlantenDialog`](../frontend/src/components/instellingen/betaalconditie-klanten-dialog.tsx). Op [`/instellingen/betaalcondities`](../frontend/src/pages/instellingen/betaalcondities.tsx) is het aantal-klanten-cijfer nu een terracotta-knop (alleen actief bij > 0). Klik opent de modal met een klikbare lijst (Nr / Naam / Plaats / Status); op klant-naam klikken navigeert naar `/klanten/:nr` en sluit de modal. Hook `useKlantenVoorBetaalconditie(code)` leest via de RPC.

## 2026-05-06 — Mig 202: betaalcondities-referentielijst + dropdown + instellingen-pagina + UI-uitbreidingen

Vervolg op de klant-bewerk-modal: betaalconditie was vrije TEXT, nu beheerbaar. Plus inkoopgroep zichtbaar in de header en delete voor geërfde klanteigen-namen.

- **Migration 202** ([`202_betaalcondities.sql`](../supabase/migrations/202_betaalcondities.sql)) — nieuwe tabel `betaalcondities (code PK, naam, dagen, omschrijving, actief)` met _all RLS-policy en `trg_set_updated_at`-trigger. Seed extraheert unieke waarden uit `debiteuren.betaalconditie` (formaat `{code} - {naam}`) en parseert `dagen` met regex `\b\d+\s*(dagen|tage|days|tag|day)\b` (case-insensitive, dus ook Duits/Engels). View `betaalcondities_met_aantal_klanten` voor het gebruiks-aantal in het overzicht. `NOTIFY pgrst, 'reload schema'` aan het einde. Idempotent.
- **Instellingen-pagina** [`/instellingen/betaalcondities`](../frontend/src/pages/instellingen/betaalcondities.tsx) — CRUD inclusief actief-toggle, "aantal klanten"-kolom, en delete-bescherming (kan niet als nog gebruikt). Sidebar-item "Betaalcondities" met `Receipt`-icon. [`BetaalconditieFormDialog`](../frontend/src/components/instellingen/betaalconditie-form-dialog.tsx) volgt patroon van afwerking-form.
- **Dropdown in [`KlantEditDialog`](../frontend/src/components/klanten/klant-edit-dialog.tsx)** — text-input vervangen door select met actieve betaalcondities (via `useActieveBetaalcondities`). Bij submit wordt de gekozen code + naam terug-geschreven naar `debiteuren.betaalconditie` als `"{code} - {naam}"`-string, zodat de bestaande factuur-RPC (regex-parse op `^\d+`) ongewijzigd blijft werken. Orphan-handling: een huidige conditie die niet in de actieve lijst staat blijft als optie zichtbaar (gemarkeerd "(niet in lijst)") zodat data niet verloren gaat.
- **Inkoopgroep zichtbaar in header-card** — [`klant-detail.tsx`](../frontend/src/pages/klanten/klant-detail.tsx) splitst de info-grid in 2 rijen: NAW (4 kolommen) en commercieel (5 kolommen) met Prijslijst — Inkoopgroep — Korting — Betaalconditie — Omzet YTD. Inkoopgroep is een terracotta-link naar `/inkoopgroepen/:code`.
- **Delete op geërfde klanteigen-namen** — voorheen was de Trash-knop verborgen voor inkoopgroep-rijen, dus de gebruiker kon op de klant-tab geen enkele alias verwijderen als alle rijen geërfd waren. [`fetchKlanteigenVoorKlant`](../frontend/src/lib/supabase/queries/klanteigen-namen.ts) geeft nu `inkoopgroep_row_id` mee voor geërfde rijen; [`KlanteigenNamenTab`](../frontend/src/components/klanten/klanteigen-namen-tab.tsx) toont de Trash-knop ook op die rijen, met een sterk geformuleerde confirmation dat verwijderen de alias voor álle klanten in de inkoopgroep weghaalt + suggestie om in plaats daarvan "Wijzig" te gebruiken voor een klant-specifieke override.

## 2026-05-06 — Mig 200: klanteigen namen op inkoopgroep-niveau + TKA013-import

Lange tijd ontbrekende koppeling: de oude TKA013-export uit Karpi bevat **klant- én inkoopgroep-eigen kwaliteit-aliassen** (BEAC = "BREDA" voor klant 100004, BEAC = "ROYAL IBIZA" voor INKC04 etc.), maar de inkoopgroep-niveau rijen werden nooit ingeladen — `klanteigen_namen` had alleen `debiteur_nr` als eigenaar. Filialen onder een inkoopgroep moesten elke alias afzonderlijk overnemen, wat in de praktijk niet gebeurd is.

- **Migration 200** ([`200_klanteigen_namen_inkoopgroep.sql`](../supabase/migrations/200_klanteigen_namen_inkoopgroep.sql)) — voegt `inkoopgroep_code TEXT REFERENCES inkoopgroepen(code) ON DELETE CASCADE` + `bron`/`created_at`/`updated_at` toe. Maakt `debiteur_nr` nullable en handhaaft via CHECK `klanteigen_namen_debiteur_xor_inkoopgroep` dat precies één van beide niveaus gevuld is. Voegt partial UK `klanteigen_namen_groep_kwal_kleur_uk` toe op `(inkoopgroep_code, kwaliteit_code, COALESCE(kleur_code, ''))`.
- **RPC `resolve_klanteigen_naam(debiteur, kwaliteit, kleur)`** — uitgebreid met inkoopgroep-fallback. Volgorde: klant+kleur > klant+NULL kleur > inkoopgroep+kleur > inkoopgroep+NULL kleur > NULL. Inkoopgroep-tak joint via `debiteuren.inkoopgroep_code`.
- **RPC `resolve_klanteigen_namen_voor_debiteur(debiteur)`** — batch-variant die per kwaliteit/kleur óf de klant-rij óf de geërfde inkoopgroep-rij retourneert (klant heeft voorrang). Gebruikt door de orders-laag om in één round-trip de map te bouwen voor de regel-weergave.
- **RPC `upsert_klanteigen_naam(...)`** — server-side upsert die de XOR + NULL-kleur-matching afhandelt; supabase-js `.upsert()` kan niet richten op een functional unique index, dus dit is de schoonste UI-route.
- **Excel-import** ([`import/import_klanteigen_namen.py`](../import/import_klanteigen_namen.py)) — leest `TKA013_Overzicht_*.xls`, splitst op debiteur-nr (numeriek) vs INKC-code (`INKC02` ..). Strategie: **delete-by-bron + insert** (idempotent herlaadbaar) in plaats van upsert, omdat PostgREST `.upsert()` niet richt op de functional partial unique indexen `COALESCE(kleur_code, '')`. Skipt + logt onbekende debiteuren / inkoopgroepen / kwaliteiten naar `import/logs/`. Bron-tag `TKA013-2026-03-19`.
- **Frontend queries + hooks** — nieuwe module [`klanteigen-namen.ts`](../frontend/src/lib/supabase/queries/klanteigen-namen.ts) + [`use-klanteigen-namen.ts`](../frontend/src/hooks/use-klanteigen-namen.ts) met `fetchKlanteigenVoorKlant` (klant + overerving), `fetchKlanteigenVoorInkoopgroep`, `upsertKlanteigenNaam` (via RPC), `updateKlanteigenNaam` (op id), `deleteKlanteigenNaam`.
- **Klant-tab** ([`klanteigen-namen-tab.tsx`](../frontend/src/components/klanten/klanteigen-namen-tab.tsx)) — toont nu klant-eigen rijen én geërfde inkoopgroep-rijen in één tabel, met kolom **Bron** (groene `klant`-badge of amber `groep · INKC02`). Geërfde rijen krijgen alleen "overschrijven"-knop (creëert klant-specifieke override). Edit/delete blijven gedrag voor klant-rijen.
- **Inkoopgroep-detail** ([`inkoopgroep-detail.tsx`](../frontend/src/pages/inkoopgroepen/inkoopgroep-detail.tsx)) — krijgt tab-systeem met "Leden" en nieuwe **Eigen benamingen**-tab ([`inkoopgroep-eigen-namen-tab.tsx`](../frontend/src/components/inkoopgroepen/inkoopgroep-eigen-namen-tab.tsx)). Wijzigingen werken meteen door op alle gekoppelde leden via overerving.
- **Order-pre-fill** ([`order-line-editor.tsx`](../frontend/src/components/orders/order-line-editor.tsx)) — `omschrijving` op nieuwe regel wordt nu gevuld met `klant_eigen_naam` (van klant- of inkoopgroep-niveau) als die bestaat; anders generieke `producten.omschrijving`. Pakt PDF/factuur/orderbevestiging direct mee.
- **Orders-laag** ([`orders.ts`](../frontend/src/lib/supabase/queries/orders.ts)) — batch-fetch via `resolve_klanteigen_namen_voor_debiteur`-RPC i.p.v. directe SELECT, zodat overerving automatisch in de regel-display verschijnt.
- **EDI uitgaand** — geen wijziging nodig: het Karpi-fixed-width-format ([`karpi-fixed-width.ts`](../supabase/functions/_shared/transus-formats/karpi-fixed-width.ts)) heeft geen omschrijving-veld op regel-niveau (alleen GTIN/artikelcode/aantal). Transus mapt zelf naar EDIFACT en gebruikt productinformatie op basis van GTIN; klant-eigen-namen lopen dus niet via deze keten.

## 2026-05-06 — Mig 201: herstel `verzendkosten` + `verzend_drempel` op debiteuren

Tijdens het bewerken van de klant-detail bleek dat opslaan van verzendkosten en drempel-bedrag faalde met PostgREST `PGRST204 — Could not find the 'verzendkosten' column of 'debiteuren' in the schema cache`. Root-cause: de oorspronkelijke migratie 032 (uit april 2026) is uit de repo verwijderd maar **nooit op deze database toegepast**, terwijl frontend ([`klant-detail.tsx`](../frontend/src/pages/klanten/klant-detail.tsx)) en order-flow ([`order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts) `fetchClientCommercialData`) er wel naar verwezen.

- **Migration 201** ([`201_verzendkosten_per_klant.sql`](../supabase/migrations/201_verzendkosten_per_klant.sql)) — voegt idempotent `verzendkosten NUMERIC(6,2) DEFAULT 35.00` en `verzend_drempel NUMERIC(8,2) DEFAULT 500.00` toe via `ADD COLUMN IF NOT EXISTS`. Bestaande rijen krijgen automatisch de defaults via PostgreSQL's `ADD COLUMN ... DEFAULT`. Sluit af met `NOTIFY pgrst, 'reload schema'` zodat de Supabase REST-laag de nieuwe kolommen direct serveert (anders blijft PGRST204 nog ~10 min hangen). Veilig herhaalbaar.
- **Aanleiding:** [memory `reference_karpi_legacy_migraties`](../C:/Users/migue/.claude/projects/c--Users-migue-Documents-Karpi-ERP/memory/reference_karpi_legacy_migraties.md) — meerdere migraties zijn historisch uit de repo verdwenen via squashes; deze is er één van die niet op de live-DB hersteld was.

## 2026-05-06 — Klant-detail: error-feedback op inline mutations + email-factuur bewerkbaar + bewerk-modal

Op de klant-detail pagina faalden inline-edits zoals verzendkosten en drempel gratis verzending stilzwijgend — als een update niet werkte (bv. door RLS, kolomprobleem, netwerk) bleef het edit-formulier hangen zonder feedback. Mutations hadden geen `onError`-handler. Daarnaast: de header-velden (naam, adres, telefoon, email, BTW, korting, betaalconditie) waren niet bewerkbaar.

- **Robuuste error-feedback** — alle inline-mutations in [`klant-detail.tsx`](../frontend/src/pages/klanten/klant-detail.tsx) en [`klant-facturering-tab.tsx`](../frontend/src/components/klanten/klant-facturering-tab.tsx) krijgen een `onError` die niet alleen `Error`-instances afvangt, maar ook plain objects met een `.message`/`.details`/`.hint`/`.code`-shape (zoals Supabase's `PostgrestError`). De volle error wordt naar console gelogd. Voorkomt "onbekende fout"-alerts waar de echte oorzaak onder zat.
- **E-mailadres factuur bewerkbaar** — [`KlantFactureringTab`](../frontend/src/components/klanten/klant-facturering-tab.tsx) krijgt een inline "Wijzig" naast `email_factuur` met email-input + opslaan/annuleren. Lege waarde slaat als `NULL` op. Hint onder het veld wijst naar de `factuur-verzenden` edge function — die ondersteunt momenteel één ontvanger per klant.
- **Klant-bewerk-modal** — nieuwe component [`KlantEditDialog`](../frontend/src/components/klanten/klant-edit-dialog.tsx) gekoppeld aan een potlood-knop rechtsboven de header-card. Bewerkt in één formulier: `naam`, `status`, `adres`, `postcode`, `plaats`, `land`, `telefoon`, `email_factuur`, `btw_nummer`, `gln_bedrijf`, `korting_pct`, `betaalconditie`. Eén UPDATE-roundtrip; lege strings worden als `NULL` opgeslagen. Specialistische velden (prijslijst, vertegenwoordiger, inkoopgroep, factuuradres, verzending/leveringen) blijven bij hun eigen knoppen — de modal verwijst daarnaar in een footer-hint.

## 2026-05-06 — Klanteigen namen beheerbaar + per-kleur verfijning — mig 199

Op de klant-detailpagina kon je tot nu toe alleen kijken naar `klanteigen_namen` — niet wijzigen. Nu volledige CRUD plus een nieuwe dimensie voor kleur-specifieke naamgeving.

- **Migration 199** ([`199_klanteigen_namen_kleur_code.sql`](../supabase/migrations/199_klanteigen_namen_kleur_code.sql)) — voegt kolom `kleur_code TEXT` toe (nullable). Vervangt de oude `(debiteur_nr, kwaliteit_code)`-UK door een functional partial unique index `(debiteur_nr, kwaliteit_code, COALESCE(kleur_code, ''))` zodat NULL-kleur als waarde meetelt voor uniqueness. Defensieve DO-blocks zorgen dat de migratie ook werkt als mig 200 (inkoopgroep) nog niet is toegepast — inkoopgroep-partial-index en de uitgebreide RPC-versie worden alleen aangemaakt als de kolom `inkoopgroep_code` al bestaat.
- **`resolve_klanteigen_naam(debiteur_nr, kwaliteit, kleur)`** — nu kleur-bewust. Volgorde: 1) klant + specifieke kleur, 2) klant + NULL kleur, 3) inkoopgroep + specifieke kleur, 4) inkoopgroep + NULL kleur, 5) NULL. Backwards-compatible: bestaande callers die zonder `p_kleur_code` aanroepen krijgen identiek gedrag.
- **Frontend**: [`KlanteigenNamenTab`](../frontend/src/components/klanten/klanteigen-namen-tab.tsx) volledig herzien — toevoegen-formulier met kwaliteit-autocomplete + optionele kleur-dropdown (gevuld uit actieve producten van de gekozen kwaliteit), per-rij wijzig/verwijder, zoekbalk op kwaliteit/naam/omschrijving. Hooks `useCreateKlanteigenNaam` / `useUpdateKlanteigenNaam` / `useDeleteKlanteigenNaam` / `useKleurenVoorKwaliteit` in [`use-klanten.ts`](../frontend/src/hooks/use-klanten.ts).
- **Order-detail klant_eigen_naam**: [`fetchOrderRegels`](../frontend/src/lib/supabase/queries/orders.ts) selecteert nu ook `producten.kleur_code` en bouwt de map op `${kwaliteit}_${kleur ?? ''}`. Specifieke (kwaliteit, kleur)-match wint per regel van de NULL-kleur fallback.
- **Order-form**: [`fetchKlanteigenNaam`](../frontend/src/lib/supabase/queries/order-mutations.ts) accepteert nu een derde parameter `kleurCode` en geeft die door aan de RPC. `SelectedArticle` heeft een veld `kleur_code` erbij; `article-selector` en `kwaliteit-first-selector` vullen het. Bij omsticker-flow erft `fysiekArticle` de kleur via spread (kwaliteit verandert, kleur blijft gelijk).

## 2026-05-06 — Fix: RLS-policies op vertegenwoordiger_werkdagen — mig 196

Toggle in de werkdagen-tab deed niets omdat mig 195 de tabel aanmaakte zonder RLS-policies. Op dit project staat RLS by default aan, dus elke INSERT/UPDATE/DELETE werd silent geweigerd. Mig 196 voegt de standaard `_all`-policy voor `authenticated` toe (`USING true / WITH CHECK true`) — zelfde patroon als `vervoerders` (mig 170) en `zendingen` (mig 169). Daarnaast: "Code: X" weggehaald uit de verteg-detail header — niet inhoudelijk relevant voor een gebruiker.

## 2026-05-06 — Verteg-contact bewerkbaar + werkdagen-tab — mig 195

Sluit aan op de klant↔verteg-koppeling van eerder vandaag. De verteg-detail pagina was tot nu toe read-only voor de basisgegevens en bevatte geen plek voor werkdagen — beide nu opgelost.

- **Inline edit van email + telefoon** in de header card van [`/vertegenwoordigers/:code`](../frontend/src/pages/vertegenwoordigers/vertegenwoordiger-detail.tsx). Component [`VertegContactEdit`](../frontend/src/components/vertegenwoordigers/verteg-contact-edit.tsx) toont mail/telefoon als klikbare links (`mailto:` / `tel:`) en onthult een "Wijzig"-knop bij hover. Lege waarde wordt opgeslagen als `NULL`.
- **Nieuwe tab "Werkdagen"** met [`VertegWerkdagenTab`](../frontend/src/components/vertegenwoordigers/verteg-werkdagen-tab.tsx). Eén rij per ISO-dag (ma–zo) met toggle, optionele start-/eindtijd en vrije opmerking. Toggle aan/uit upsert/delete de rij; tijd-velden auto-saven on-blur.
- **Migration 195** ([`195_vertegenwoordiger_werkdagen.sql`](../supabase/migrations/195_vertegenwoordiger_werkdagen.sql)) — nieuwe tabel `vertegenwoordiger_werkdagen` met PK `(vertegenw_code, dag_van_week)`, FK met `ON DELETE CASCADE ON UPDATE CASCADE`, CHECK op tijd-volgorde. **Rij aanwezig = werkt die dag** (sparse model — geen pre-seed met `werkt=false`). Tijden en opmerking blijven NULL als ze niet ingevuld zijn.
- **Hooks**: `useUpdateVerteg`, `useVertegWerkdagen`, `useUpsertVertegWerkdag`, `useDeleteVertegWerkdag` in [`use-vertegenwoordigers.ts`](../frontend/src/hooks/use-vertegenwoordigers.ts) — invalidaten gerichte query-keys (`['vertegenwoordigers', code, 'werkdagen']`) zodat het overzicht en stat-cards niet onnodig refetchen.

Toekomstig nut: verteg-werkdagen kunnen straks meegenomen worden in levertijd-inschattingen of route/agenda-planning.

## 2026-05-06 — Vertegenwoordiger-koppeling beheerbaar in UI (klant ↔ verteg)

Voorheen was `debiteuren.vertegenw_code` alleen via de import of SQL te wijzigen — de UI toonde de naam alleen als read-only tekst. Nu zit het beheer aan beide kanten.

- **Op /klanten/:id** — de "Verteg:"-tekst in de header en het "Vertegenwoordiger"-veld in de Info-tab zijn vervangen door [`KlantVertegSelector`](../frontend/src/components/klanten/klant-verteg-selector.tsx) (zelfde patroon als `KlantPrijslijstSelector`): inline dropdown met zoekveld, optie "loskoppelen" als er een verteg gezet is. Schrijft direct naar `debiteuren.vertegenw_code`.
- **Op /vertegenwoordigers/:code** — Klanten-tab heeft nu een "+ Klant koppelen"-knop die [`VertegKoppelKlantDialog`](../frontend/src/components/vertegenwoordigers/verteg-koppel-klant-dialog.tsx) opent. Dialog toont alle actieve debiteuren met zoek (naam/plaats/debiteur-nr); klanten al gekoppeld aan déze verteg zijn verborgen; klanten met een andere verteg krijgen een amber waarschuwings-tag. Bij selectie van een klant met andere verteg verschijnt een bevestigings-dialog "Vertegenwoordiger overschrijven?". Daarnaast krijgt elke rij in de klanten-tabel een ontkoppel-icoon (`Unlink`).
- **Max 1 verteg per klant** is automatisch gegarandeerd — `vertegenw_code` is een single FK, niet een join-tabel. Geen schema-wijziging nodig.
- **Mutation** `useSetKlantVerteg` in [`use-vertegenwoordigers.ts`](../frontend/src/hooks/use-vertegenwoordigers.ts) invalidatet `['klanten']` + `['vertegenwoordigers']` zodat overzichten en stat-cards meteen kloppen.

## 2026-05-06 — Afwerking-kleuren centraliseren (Piero Taupe 431 als master) — mig 194

Voorheen zat "Piero Taupe 431" verspreid over (a) hardcoded `Piero `-prefix in [`kwaliteit-first-selector.tsx`](../frontend/src/components/orders/kwaliteit-first-selector.tsx) en (b) drie losse velden (`band_merk`/`band_omschrijving`/`band_kleur`) in `maatwerk_band_defaults`. Het bandkleur-veld in de order-form was vrije tekst — typo's lekten naar snijbon, sticker en straks EDI. Nu één master-tabel, één spelling, strict-dropdown.

- **Nieuwe master-tabel `afwerking_kleuren`** — per afwerking eigen scope (UK `(afwerking_code, label)`). Eén `label`-veld zoals "Piero Taupe 431". `actief`-flag voor soft-delete; FK in `maatwerk_band_defaults` en `order_regels` heeft `ON DELETE RESTRICT`.
- **Auto-seed onder SB**: 250+ rijen uit `maatwerk_band_defaults` waar `band_kleur ~ '^[0-9]+(-[0-9]+)?$'` (Piero/Pantone) → label `'Piero ' || initcap(band_omschrijving) || ' ' || band_kleur`. Niet-Piero rijen (DA12, RM12, PE21) blijven met `afwerking_kleur_id IS NULL` en moeten handmatig via de UI gekoppeld worden.
- **`maatwerk_band_defaults.afwerking_kleur_id`** — nieuwe FK-kolom (nullable), backfilled voor matchende Piero-rijen. `band_kleur` NOT NULL gedropt — FK-only rijen kunnen voortaan bestaan zonder legacy-tekst.
- **`order_regels.maatwerk_band_kleur_id`** — nieuwe FK-kolom naast bestaande `maatwerk_band_kleur` TEXT. Tekst blijft als historische snapshot; nieuwe orders schrijven beide.
- **RPC's** [`create_order_with_lines`](../supabase/migrations/194_afwerking_kleuren.sql) en `update_order_with_lines` accepteren `maatwerk_band_kleur_id`.
- **UI /afwerkingen** — afwerking-rijen met `heeft_band_kleur=true` zijn nu uit te vouwen via een chevron. Submenu in [`afwerking-kleuren-submenu.tsx`](../frontend/src/components/instellingen/afwerking-kleuren-submenu.tsx) — toevoegen, hernoemen, soft-delete (actief-flag) en hard-delete (FK-blocked indien in gebruik).
- **UI /producten** — kwaliteit-uitvouw vervangen door [`kwaliteit-kleuren-uitvouw.tsx`](../frontend/src/pages/producten/kwaliteit-kleuren-uitvouw.tsx). Bovenin: dropdown voor de standaard-afwerking van die kwaliteit (slaat op in `kwaliteit_standaard_afwerking`). Daaronder kleur-rijen met per kleur een bandkleur-dropdown (slaat op in `maatwerk_band_defaults.afwerking_kleur_id`). Klik kleur uit → artikels van die (kwaliteit, kleur) verschijnen één laag dieper.
- **Order-form** ([`vorm-afmeting-selector.tsx`](../frontend/src/components/orders/vorm-afmeting-selector.tsx)) — bandkleur tekstveld vervangen door strict-dropdown. Default voorgeselecteerd uit `maatwerk_band_defaults.afwerking_kleur_id`. Bij lege kleur-lijst onder de gekozen afwerking: amber hint "Beheer onder /afwerkingen". Geen vrije-tekst-fallback in de form — nieuwe kleuren toevoegen kan alleen via /afwerkingen.

## 2026-05-06 — Prijslijst verwijderen vanuit detail

Sluit aan op de aanmaak-flow van vandaag — een prijslijst die per ongeluk aangemaakt of niet meer gebruikt wordt kan nu ook in de UI weg.

- **Verwijder-knop** (rose, met `Trash2`-icoon) rechtsboven in de header van [`/prijslijsten/:nr`](../frontend/src/pages/prijslijsten/prijslijst-detail.tsx). Bevestigt eerst, navigeert daarna terug naar `/prijslijsten`.
- **Beveiliging tegen ongewenste verwijdering:**
  - Als er nog ≥1 klant gekoppeld is wordt de delete client-side geblokkeerd met een melding `"Koppel die eerst los via de Klanten-tab"`. Reden: `debiteuren.prijslijst_nr` heeft geen `ON DELETE` — Postgres zou alsnog blokkeren met een opaque FK-error.
  - Anders volgt een confirm-dialog die expliciet vermeldt hoeveel regels meeverwijderd worden. Regels gaan via `prijslijst_regels.prijslijst_nr ... ON DELETE CASCADE` automatisch mee.
- **Query + hook:** `deletePrijslijst(nr)` in [`prijslijsten.ts`](../frontend/src/lib/supabase/queries/prijslijsten.ts), `useDeletePrijslijst()` in [`use-prijslijsten.ts`](../frontend/src/hooks/use-prijslijsten.ts) — invalidatet `['prijslijsten']` zodat het overzicht meteen klopt.

Geen schema-wijziging.

## 2026-05-06 — Nieuwe prijslijst aanmaken vanuit overzicht

Voorheen kon een prijslijst alleen via SQL of de Excel-import worden aangemaakt. Nu zit het volledig in de UI.

- **Knop "Nieuwe prijslijst"** rechtsboven naast de zoekbalk op [`/prijslijsten`](../frontend/src/pages/prijslijsten/prijslijsten-overview.tsx). Opent [`PrijslijstCreateDialog`](../frontend/src/components/prijslijsten/prijslijst-create-dialog.tsx).
- **Velden:** `nr` (auto-voorgesteld als `MAX(nr) + 1`, gepad tot 4 cijfers — overschrijfbaar), `naam` (verplicht), `geldig vanaf` (optionele datum). `actief` wordt op `true` gezet. Duplicate-`nr` wordt client-side gevangen.
- **Vervolgflow:** na aanmaken wordt direct genavigeerd naar `/prijslijsten/:nr?addProduct=1`. De detail-pagina detecteert deze querystring en opent automatisch [`PrijslijstAddProductDialog`](../frontend/src/components/prijslijsten/prijslijst-add-product-dialog.tsx) — zo kan in één flow een lijst aangemaakt + gevuld worden zonder extra klikken.
- **Query + hook:** `createPrijslijst` in [`prijslijsten.ts`](../frontend/src/lib/supabase/queries/prijslijsten.ts) (insert in `prijslijst_headers`); `useCreatePrijslijst` in [`use-prijslijsten.ts`](../frontend/src/hooks/use-prijslijsten.ts) invalidatet de overzicht-query zodat de nieuwe rij meteen verschijnt.

Geen schema-wijziging.

## 2026-05-06 — Producten toevoegen/verwijderen in een prijslijst

In aanvulling op het klant-koppelingsbeheer kunnen nu ook regels in een prijslijst direct vanuit de UI beheerd worden — voorheen kon dit alleen via SQL of de Excel-import.

- **Knop "Product toevoegen"** rechtsboven in de Prijzen-tab van [`/prijslijsten/:nr`](../frontend/src/pages/prijslijsten/prijslijst-detail.tsx). Opent [`PrijslijstAddProductDialog`](../frontend/src/components/prijslijsten/prijslijst-add-product-dialog.tsx) — een **2-staps wizard**:
  - **Stap 1 — selecteren:** multi-select met server-side zoek (artikelnr / karpi-code / omschrijving, met de bestaande [`applyProductSearch`](../frontend/src/lib/utils/sanitize.ts) word-boundary filter). Producten die al in de prijslijst zitten worden automatisch uitgefilterd. De selectie wordt als snapshot in een `Map<artikelnr, KoppelbaarProduct>` bewaard, zodat je tussen verschillende zoektermen door kunt klikken zonder selecties te verliezen.
  - **Stap 2 — prijzen controleren:** lijst van geselecteerde producten met inline prijs-input per regel. Default = `producten.verkoopprijs`, of leeg/€ 0,00 als die ontbreekt. Trash-knop per regel om alsnog uit de selectie te halen, "Terug"-knop om te corrigeren. Pas op submit gaan de regels met de aangepaste prijzen naar de DB.
- **Trash-icoon per regel** in de regels-tabel naast het potlood — vraagt confirm en verwijdert via [`useRemovePrijslijstRegel`](../frontend/src/hooks/use-prijslijsten.ts). Alleen zichtbaar bij rij-hover.
- **Queries** ([`prijslijsten.ts`](../frontend/src/lib/supabase/queries/prijslijsten.ts)): nieuw `KoppelbaarProduct`-type, `fetchKoppelbareProductenVoorPrijslijst(prijslijstNr, search)` (paginated set van bestaande artikelnrs + server-side product-search met limit 500), `addProductenAanPrijslijst` (insert met defaults), `removePrijslijstRegel`. Hooks idem in [`use-prijslijsten.ts`](../frontend/src/hooks/use-prijslijsten.ts).

Insert kopieert `omschrijving`, `gewicht` en `ean_code` mee uit `producten` als denormalized snapshot, in lijn met hoe bestaande regels zijn opgebouwd. Schema ongewijzigd — `prijslijst_regels.UNIQUE(prijslijst_nr, artikelnr)` voorkomt dubbele toevoeging op DB-niveau.

## 2026-05-06 — Prijslijst-koppeling beheren vanuit klant- én prijslijst-pagina

Voorheen kon `debiteuren.prijslijst_nr` alleen via SQL of een rondreis naar de oude beheer-tools gewijzigd worden. Nu zit het in de UI, met dezelfde patronen als de inkoopgroepen-koppeling.

- **Klanten-overzicht** ([`klant-card.tsx`](../frontend/src/components/klanten/klant-card.tsx)): tegeltjes tonen nu een extra regel `Prijslijst: 0145 — FLOORPASSION PER 01.07.2022` (of "geen" wanneer leeg). Naam komt mee via een join `prijslijst_headers(naam)` op de teruggegeven debiteur-batch — geen extra kosten op het hoofd-listing-query, alleen één lichte select per pagina.
- **Klant-detail** ([`klant-prijslijst-selector.tsx`](../frontend/src/components/klanten/klant-prijslijst-selector.tsx)): de "Prijslijst" InfoField in de header is vervangen door een inline selector. Klik "Wijzig" → search-dropdown over alle actieve prijslijsten + optie "Prijslijst loskoppelen". Mutatie via [`useSetKlantPrijslijst`](../frontend/src/hooks/use-klanten.ts).
- **Prijslijst-detail klanten-tab** ([`prijslijst-detail.tsx`](../frontend/src/pages/prijslijsten/prijslijst-detail.tsx)): nieuwe knop **"Klant toevoegen"** rechtsboven en een trash-icoon per rij om een klant los te koppelen. De toevoeg-knop opent [`PrijslijstAddKlantDialog`](../frontend/src/components/prijslijsten/prijslijst-add-klant-dialog.tsx) — multi-select dialoog met zoekbalk en "Selecteer zichtbare", precies zoals [`InkoopgroepAddDebiteurDialog`](../frontend/src/components/inkoopgroepen/inkoopgroep-add-debiteur-dialog.tsx). Een klant die al op een andere prijslijst zat krijgt een waarschuwingsbalk vóór bevestigen.
- **Queries** ([`klanten.ts`](../frontend/src/lib/supabase/queries/klanten.ts)): `KlantRow` kreeg `prijslijst_nr` + `prijslijst_naam`, `KlantDetail` kreeg `prijslijst_naam`. Nieuwe queries: `fetchPrijslijstHeadersList`, `fetchKoppelbareDebiteurenMetPrijslijst`, `setKlantPrijslijst`, `setKlantenPrijslijst`. Hooks idem in [`use-klanten.ts`](../frontend/src/hooks/use-klanten.ts).

Geen schema-wijziging — `debiteuren.prijslijst_nr` (TEXT FK → `prijslijst_headers.nr`) bestond al.

## 2026-05-06 — Afwerking prijs per strekkende meter + RLS-fix instellingen (mig 193)

Bij het bewerken van een vorm of afwerking via de nieuwe instellingen-pagina's faalde het opslaan met een generieke "Er ging iets mis"-melding. Onderzoek toonde twee problemen:

**RLS-bug:** mig 041 zette enkel `Anon full access`-policies op `maatwerk_vormen` en `afwerking_types`. Ingelogde gebruikers (auth-rol = `authenticated`) konden wel SELECT doen maar UPDATE/INSERT/DELETE faalde stilzwijgend. De catch-handler in de form-dialogen gooide PostgrestError-objecten weg omdat `err instanceof Error` voor die fouten `false` is — vandaar de generieke melding.

**Strekkende-meter tarief:** randafwerkingen worden in de praktijk per meter omtrek geprijsd. Een 200×300 cm tapijt heeft 2×(200+300)/100 = 10 m omtrek, een 80×150 maar 4,6 m. De legacy `prijs`-kolom (vaste toeslag) was altijd 0 en wordt niet meer in de UI getoond — blijft bestaan in de DB voor backwards-compat met bestaande snapshots in `order_regels.maatwerk_afwerking_prijs`.

**Migratie 193** ([`193_afwerking_prijs_per_meter.sql`](../supabase/migrations/193_afwerking_prijs_per_meter.sql)):
- Nieuwe kolom `afwerking_types.prijs_per_meter NUMERIC(10,2) NOT NULL DEFAULT 0`. Default 0 = backwards-compat.
- Nieuwe RLS-policy `Authenticated full access` op zowel `maatwerk_vormen` als `afwerking_types` (idempotent via `pg_policies`-check). Lost de save-bug op.

**Frontend:**
- [`berekenOmtrekMeter`](../frontend/src/lib/utils/maatwerk-prijs.ts)-helper: rond = π × diameter / 100, anders = 2 × (L+B) / 100.
- [`kwaliteit-first-selector.tsx`](../frontend/src/components/orders/kwaliteit-first-selector.tsx) en [`op-maat-selector.tsx`](../frontend/src/components/orders/op-maat-selector.tsx) berekenen afwerkingsprijs nu als `omtrek_m × prijs_per_meter`. Snapshot in `order_regels.maatwerk_afwerking_prijs` blijft 1 totaal-getal — geen schema-wijziging op orders.
- [`AfwerkingFormDialog`](../frontend/src/components/instellingen/afwerking-form-dialog.tsx) heeft één prijsveld "Prijs per strekkende meter (€)" + "Volgorde". De oude "Vaste prijs"-input is verwijderd; nieuwe upserts zetten de DB-kolom `prijs` op `0`.
- Overzichtstabel [`afwerkingen.tsx`](../frontend/src/pages/instellingen/afwerkingen.tsx) toont één kolom "Prijs/m" (formaat `€ X,XX/m`).
- `upsertVorm` / `upsertAfwerkingType` strippen nu expliciet `id` uit de update-payload en gooien echte `Error`-instances ipv ruwe `PostgrestError`-objecten. Error-display in beide dialogs valt terug op `error.message`/`JSON.stringify` in plaats van een generieke melding, en logt het origineel naar de console.

## 2026-05-06 — Beheer-pagina's voor Vormen en Afwerkingen onder /instellingen

Tot nu toe waren `maatwerk_vormen` en `afwerking_types` alleen via SQL of seed-data te muteren, terwijl ze al jaren in de order-form-dropdowns gebruikt worden (Vorm + Afwerking). Toegevoegd:

- **Pagina's:**
  - [`/instellingen/vormen`](../frontend/src/pages/instellingen/vormen.tsx) — overzicht + create/edit/delete dialoog. Toont code, naam, afmeting-type (lengte_breedte / diameter), toeslag (€) en status.
  - [`/instellingen/afwerkingen`](../frontend/src/pages/instellingen/afwerkingen.tsx) — overzicht + create/edit/delete dialoog. Toont code, naam, confectie-lane (`type_bewerking` uit mig 096), bandkleur-flag, prijs en status.
- **Hooks:** [`use-vormen.ts`](../frontend/src/hooks/use-vormen.ts) + [`use-afwerkingen.ts`](../frontend/src/hooks/use-afwerkingen.ts) wikkelen de bestaande queries uit `op-maat.ts` met React Query (invalidatie op `maatwerk-vormen` / `afwerking-types`).
- **Queries-uitbreiding:** `op-maat.ts` kreeg `deleteVorm`, `deleteAfwerkingType` en `fetchTypeBewerkingen` (lanes uit `confectie_werktijden`). `AfwerkingTypeRow` interface kreeg `type_bewerking: string | null` toegevoegd.
- **Form-dialogen:** [`vorm-form-dialog.tsx`](../frontend/src/components/instellingen/vorm-form-dialog.tsx) + [`afwerking-form-dialog.tsx`](../frontend/src/components/instellingen/afwerking-form-dialog.tsx). Code is read-only in edit-modus (PK). Vorm-codes worden genormaliseerd naar lowercase_underscore, afwerking-codes naar UPPERCASE.
- **Sidebar:** twee nieuwe items onder "Systeem" → "Vormen" (Shapes) en "Afwerkingen" (Scissors). Routes geregistreerd in [`router.tsx`](../frontend/src/router.tsx).
- **Veiligheid:** delete-knoppen waarschuwen voor mogelijke FK-fouten en raden inactief-zetten aan in plaats van fysiek verwijderen — rijen worden gebruikt als FK in `producten.maatwerk_vorm_code`, `kwaliteit_standaard_afwerking.afwerking_code` en order-regel-historie.

## 2026-05-06 — Order-prijsresolver met m²-fallback voor voorraadproducten (mig 190–191)

Bij het aanmaken van een order voor klant 640505 (WHOON OISTERWIJK) was geen prijs voor product 771150045 (`CISCO 15 CA, 240x340 cm ORGANISCH`) te bepalen — de klant heeft die specifieke vaste-maat-rij niet in zijn prijslijst, dus de bestaande `lookupPrice` leverde NULL en de UI viel terug op een statische `producten.verkoopprijs` (vaak €0). Voor maatwerk-orderregels werkte de fallback al wel via [kwaliteit-first-selector.tsx:222-272](../frontend/src/components/orders/kwaliteit-first-selector.tsx#L222-L272), maar die keten was nooit beschikbaar voor vaste-maat voorraadproducten met dezelfde kwaliteit.

**Wat nieuw is:**
- Vaste-maat voorraadproducten krijgen nu automatisch een logische m²-prijs als ze niet in de klant-prijslijst staan, met dezelfde 5-stappen fallback-keten die maatwerk al gebruikte.
- Vormtoeslag (€0/€75 uit `maatwerk_vormen.toeslag`) wordt automatisch toegepast wanneer het voorraadproduct als organisch/ovaal/pebble/ellips/afgeronde-hoeken gemarkeerd is.
- Order-form-cel toont een breakdown-hint onder de prijs (bv. *"m²-prijs uit prijslijst · 8,16 m² × € 142,50/m² + € 75,00 (Organic)"*) met tooltip — vervangt de oude "⚠ Niet uit prijslijst"-flag.

**Migratie 190** ([`190_producten_maatwerk_vorm_code.sql`](../supabase/migrations/190_producten_maatwerk_vorm_code.sql)):
- Nieuwe kolom `producten.maatwerk_vorm_code TEXT FK → maatwerk_vormen(code) ON UPDATE CASCADE ON DELETE SET NULL` + partial index.
- Backfill via patronen op `karpi_code`-suffix (`RND` → `rond`, `OVL` → `ovaal`) en `omschrijving`-substring (`ORGANISCH` → `organisch_a`, `PEBBLE`, `ELLIPS`, `AFGEROND`). Onbekend → NULL → resolver behandelt als rechthoek.
- Verifier `DO`-blok rapporteert verdeling per vorm + sanity-check op test-case 771150045.

**Migratie 191** ([`191_bereken_orderregel_prijs.sql`](../supabase/migrations/191_bereken_orderregel_prijs.sql)):
- RPC `bereken_orderregel_prijs(p_artikelnr, p_prijslijst_nr) → JSONB` met fallback-keten:
  1. `prijslijst_vast` — vaste prijs uit `prijslijst_regels`
  2. `prijslijst_m2` — m²-prijs van kleur-specifiek MAATWERK-artikel uit `prijslijst_regels` × oppervlak + vormtoeslag
  3. `maatwerk_artikel_m2` — `producten.verkoopprijs` van MAATWERK-artikel × oppervlak + vormtoeslag
  4. `kwaliteit_m2` — generieke `maatwerk_m2_prijzen.verkoopprijs_m2` × oppervlak + vormtoeslag
  5. `product_verkoopprijs` — eigen `producten.verkoopprijs` (laatste redmiddel)
- Oppervlak: bbox (`lengte × breedte / 10000`) of cirkel (`π × (diameter/200)²` als `producten.vorm = 'rond'`).
- Vormtoeslag uit `maatwerk_vormen.toeslag` via `producten.maatwerk_vorm_code`. NULL = rechthoek = €0.
- Retourneert `{ prijs, bron, breakdown }` zodat de UI kan visualiseren hoe de prijs is opgebouwd.

**Frontend** ([`frontend/src/lib/supabase/queries/order-mutations.ts`](../frontend/src/lib/supabase/queries/order-mutations.ts), [`order-form.tsx`](../frontend/src/components/orders/order-form.tsx), [`order-line-editor.tsx`](../frontend/src/components/orders/order-line-editor.tsx)):
- Nieuwe query `resolveOrderlinePrice(artikelnr, prijslijstNr)` roept de RPC aan.
- `handleArticleSelected` + reprice-bij-klantwissel gebruiken nu de resolver (vervangt directe `lookupPrice`-aanroepen voor vaste artikelen). Verzendkosten/spoedtoeslag overgeslagen — die hebben eigen logica.
- Nieuwe types `PrijsBron` + `PrijsBreakdown` op `OrderRegelFormData` (display-only, niet opgeslagen).
- Nieuwe utility [`prijs-bron.ts`](../frontend/src/lib/utils/prijs-bron.ts) vertaalt bron + breakdown naar Nederlandstalige hint-tekst + tooltip + kleur.

**Buiten scope (bewust):**
- Geen wijziging aan factuur-rendering of kortings-flow — resolver geeft ex-korting prijs terug.
- UI om `producten.maatwerk_vorm_code` handmatig te muteren komt later (huidige backfill dekt 95%; rest blijft NULL = rechthoek).
- De kanttekening uit [`fetchMaatwerkArtikelNr`](../frontend/src/lib/supabase/queries/op-maat.ts#L161-L217) over uitwisselgroep-strategie 4 is niet meegenomen in de RPC; dekt 95% van praktijkgevallen.

**HITL — migraties 190 + 191 handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Pre-check de `RAISE NOTICE`-output van mig 190 om te valideren dat 771150045 op `organisch_a` uitkomt.

## 2026-05-06 — Inkoopgroepen als first-class entiteit (mig 189)

10 inkooporganisaties (INKC-codes — BEGROS, DECOR UNION, FACHHANDELSRING, INTERRING, VME, VME (TH), TINTTO, INHOUSE, HOUSE OF DUTCHZ, MUSTERRING) staan in productie als gedeelde prijslijst-/kortingsgroep voor klanten. Tot nu was dit een losse TEXT-kolom `debiteuren.inkooporganisatie` zonder beheermogelijkheid in de UI. Nieuwe entiteit met eigen module zodat de owner debiteuren centraal kan toevoegen of verwijderen uit een inkoopgroep, en in het klantbeeld direct ziet onder welke groep de klant valt.

**Migratie 189** ([`189_inkoopgroepen.sql`](../supabase/migrations/189_inkoopgroepen.sql)):
- Tabel `inkoopgroepen` (`code` PK, `naam`, `omschrijving`, `actief`).
- Seed van de 10 bekende groepen via `INSERT ... ON CONFLICT DO NOTHING`.
- FK-kolom `debiteuren.inkoopgroep_code` (`ON UPDATE CASCADE, ON DELETE SET NULL`) + index.
- Backfill-stap: normaliseert bestaande `debiteuren.inkooporganisatie`-strings (whitespace + uppercase) en matcht op `code`. Verifier-`DO`-blok logt aantal gematcht/niet-gematcht en somt niet-gematchte unieke waarden op vóór de DROP COLUMN — owner kan dan eerst de seed uitbreiden als er onbekende codes zijn.
- Drop oude TEXT-kolom op debiteuren. `orders.inkooporganisatie` blijft als snapshot — orders mogen niet meebewegen.
- View `inkoopgroepen_met_aantal_leden` voor het overzichtsscherm.

**Python seed-script** [`import/import_inkoopgroepen.py`](../import/import_inkoopgroepen.py) leest de 10 INKC*.xlsx-bestanden uit de project-root (geleverd door owner), extraheert de code uit de bestandsnaam (`INKC{nn}`), vindt de debiteur-kolom heuristisch (kolomnaam of bereik 100000–999999), en bulk-update `debiteuren.inkoopgroep_code`. Idempotent. Print per groep aantal succesvol gekoppeld + niet-gevonden debiteur_nrs + DB-validatie.

**Update import** [`import/supabase_import.py`](../import/supabase_import.py): nieuwe helper `extract_inkc_code()` normaliseert "Inkooporg."-Excel-waardes (vrije tekst zoals `INKC 14` of `INKC02 BEGROS`) naar `INKC{nn}` en schrijft naar de FK-kolom — re-imports blijven functioneel.

**Frontend module** — eigen route `/inkoopgroepen` (overzicht: code, naam, aantal_leden, actief) + `/inkoopgroepen/:code` (detail met leden-tabel + "Debiteur toevoegen"-modal). Sidebar-item onder "Klanten" in de Commercieel-groep. Klant-detail Info-tab toont nu `Inkoopgroep` als klikbare link. Klanten-overview krijgt extra filter-dropdown "Inkoopgroep". Mutations invalidaten zowel `['inkoopgroepen']` als `['klanten']` query-keys.

**HITL — migratie 189 handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Idempotent qua schema; pre-check de `RAISE NOTICE`-output uit het verifier-blok vóór de DROP COLUMN-stap doorgaat.

## 2026-05-06 — Vorm-aware gewicht-resolver voor ronde producten (mig 188)

Vervolg op de gewicht-per-kwaliteit-feature (mig 184–186). Bij live-controle bleek dat **160 ROND** en **200 ROND** beide hetzelfde gewicht (3.7 kg) toonden in de prijslijst. Oorzaak: mig 184's regex `^.{8}(\d{3})(\d{3})$` matcht alleen rechthoekige `karpi_code`-suffixen. Voor RND/OVL-suffixen bleven `lengte_cm` en `breedte_cm` NULL, dus `bereken_product_gewicht_kg` viel terug op de legacy `producten.gewicht_kg` — een placeholder uit het oude systeem (bij LORANDA toevallig 3.7 kg per stuk, ongeacht maat).

**Scope** (smal — beslissing van de owner):
- Rond → cirkel-formule `π × (diameter/200)² × density`.
- Ovaal → bbox-formule (rechthoek-aanname). Overschat ~27% (factor 4/π) maar pragmatisch.

**Migratie 188** ([`188_vorm_rond_gewicht.sql`](../supabase/migrations/188_vorm_rond_gewicht.sql)):
- Nieuwe kolom `producten.vorm` (`rechthoek` default | `rond`) met CHECK-constraint.
- **RND parsing** (1541 producten): `karpi_code ~ '^.{8}\d{3}RND$'` → `lengte_cm = breedte_cm = diameter`, `vorm = 'rond'`.
- **OVL parsing** (127 producten): bbox uit omschrijving (`(\d+)\s*[xX]\s*(\d+)\s*cm\s*OVAAL`) → `lengte_cm + breedte_cm` als rechthoek-bbox. `vorm` blijft `rechthoek`.
- **Resolver-update** `bereken_product_gewicht_kg` nu vorm-aware: `vorm='rond'` → `π × (lengte_cm/200)² × density`; anders bbox-formule.
- **Trigger-update** `trg_kwaliteit_gewicht_recalc` zelfde vorm-logica in cascade.
- **Self-update truc**: `UPDATE kwaliteiten SET gewicht_per_m2_kg = gewicht_per_m2_kg WHERE gewicht_per_m2_kg IS NOT NULL` — vuurt de trigger zodat alle bestaande RND/OVL-producten direct herrekend worden met de nieuwe formules. Idempotent.
- Verifier-rapport in `DO $$ ... $$`-blok telt rond/ovl-producten + `gewicht_uit_kwaliteit=true`-totaal.

**Verwachte resultaten na apply** (LORANDA Kleur 11, density 3.7 kg/m²):
- 160 ROND: π × 0.8² × 3.7 ≈ **7.44 kg** (was 3.7).
- 200 ROND: π × 1.0² × 3.7 ≈ **11.62 kg** (was 3.7).
- 160×230 cm rechthoek: 13.62 kg (ongewijzigd).

**HITL — migratie 188 handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Idempotent: `ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION` + self-update.

## 2026-05-06 — Pick & Ship verzendset PGRST201-fix

Bugfix voor de knop **Verzendset** op de Pick & Ship-kaart: de printset-route faalde met `PGRST201` omdat de logistiek-zending queries `orders -> debiteuren` embedden zonder FK-disambiguatie. `orders` heeft twee relaties naar `debiteuren` (`debiteur_nr` voor de besteller en `betaler` voor de betalende partij), waardoor PostgREST niet kon kiezen. In [`frontend/src/modules/logistiek/queries/zendingen.ts`](../frontend/src/modules/logistiek/queries/zendingen.ts) gebruiken de zending-overzicht-, detail- en printset-query nu expliciet `debiteuren:debiteuren!orders_debiteur_nr_fkey(...)`, zodat de bestaande frontend-shape gelijk blijft en altijd de bestellende klant wordt geladen. Toegevoegd: contracttest [`zendingen-query.contract.test.ts`](../frontend/src/modules/logistiek/__tests__/zendingen-query.contract.test.ts) die deze queryvorm bewaakt.

## 2026-05-06 — Voorraadpositie-Module post-cutover fixes

Twee fixes na de eerste live-apply-poging van de Voorraadpositie-Module-migraties:

1. **Mig 180 — `producten.naam` → `producten.omschrijving`.** De batch+filter-RPC verwees naar een niet-bestaande kolom `producten.naam` (de echte kolom heet `omschrijving`, conform alle andere SQL — bv. mig 105/107/108/162). Dit faalde bij apply met `ERROR: 42703: column p.naam does not exist`. Gefixt op vier plekken in [`180_voorraadposities_batch_filter.sql`](../supabase/migrations/180_voorraadposities_batch_filter.sql): de `product_naam_per_paar`-CTE-source, de `p_search`-ILIKE-clausule via `pn.naam` (interne CTE-alias blijft `naam`), en twee documentatie-comments. Output-shape ongewijzigd — `product_naam`-kolom in de RPC-output bevat dezelfde tekst als voorheen, alleen de bron-kolom is correct.
2. **Migratie-hernummering ten gevolge van collisie met gewicht-workstream.** Tijdens onze sessie liep een parallelle ungecommitte gewicht-per-kwaliteit-feature (mig 180/181/182) die identieke nummers gebruikte als de Voorraadpositie-Module (mig 180 + mig 182). De gewicht-set is hernummerd naar `184_/185_/186_`, en mijn `183_oude_rpcs_cleanup.sql` (T005) is verschoven naar [`187_oude_rpcs_cleanup.sql`](../supabase/migrations/187_oude_rpcs_cleanup.sql) voor consecutive ordering met de gewicht-set. Doc-refs in [`database-schema.md`](database-schema.md), `ralph/state.json` en `fixture-10-ghost-besteld-paren.test.ts` bijgewerkt: "mig 183" → "mig 187". Geen functionele wijziging — alleen filename/comment.

**HITL** (na deze fix): mig 180 opnieuw apply'en op Supabase Karpi-project. Idempotent (`CREATE OR REPLACE FUNCTION`). De eerdere mislukte transactie heeft niets achtergelaten.

## 2026-05-06 — Oude RPC's na Voorraadpositie-Module-cutover (T005 / #30)

Vijfde en laatste slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Cleanup van de drie RPC's die door `voorraadposities()` (mig 179/180) zijn vervangen: `rollen_uitwissel_voorraad` (mig 112/115), `uitwisselbare_partners` (mig 114/115), `besteld_per_kwaliteit_kleur` (mig 137). Hiermee is de epic compleet — alle vijf taken (T001–T005) staan.

- **Audit-bevindingen — geen externe callers meer**:
  - `rollen_uitwissel_voorraad`: 0 callers in frontend / edge-functions / scripts / import / SQL-callers (voorraadposities consumeert 'm NIET — die roept `uitwisselbare_partners()` rechtstreeks aan). ⇒ **DROP**.
  - `uitwisselbare_partners`: 0 directe externe callers. SQL-caller: `voorraadposities()` (CTE-bron in partners-aggregaat). ⇒ **DEMOTE** (COMMENT-only). GRANT EXECUTE blijft voor `anon`/`authenticated` omdat `voorraadposities()` als `LANGUAGE sql STABLE` (= SECURITY INVOKER) inner-permissies eist.
  - `besteld_per_kwaliteit_kleur`: na T005-refactor enige frontend-callers via Module-seam (`fetchVoorraadpositie` + nieuw `fetchGhostBesteldParen`). SQL-caller: `voorraadposities()`. ⇒ **DEMOTE** (COMMENT-only). GRANT blijft om dezelfde reden + omdat `fetchGhostBesteldParen` vanuit de browser draait met `anon`/`authenticated`.
- **Optie Y-refactor (ghost-merge achter Module-seam)**: `pages/rollen/rollen-overview.tsx` riep direct `supabase.rpc('besteld_per_kwaliteit_kleur')` aan (T003's ghost-merge). Verplaatst naar nieuwe Module-export [`fetchGhostBesteldParen`](../frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts). Module's bestaans-regel ("batch-modus geeft alleen eigen-voorraad-paren") onveranderd; ghost-merge-logica blijft op page-niveau. Resultaat: alle frontend-DB-calls voor de Voorraadpositie-data-flow lopen nu door de Module-barrel, zodat `besteld_per_kwaliteit_kleur` logisch gedemoot kan worden zonder breuk.
- **Mig 187 — uitvoering**: `DROP FUNCTION IF EXISTS rollen_uitwissel_voorraad();` + twee `COMMENT ON FUNCTION` met "INTERN — niet direct aanroepen vanuit nieuwe code"-richtlijn voor de andere twee. Geen `REVOKE` (zou `voorraadposities()` breken).
- **Tests**: nieuwe regression-fixture 10 (`fetchGhostBesteldParen` shape + RPC-aanroep + lege-array fallback bij fout + null→0-cast voor numerieken). 4 nieuwe tests (96/97 groen, 1 perf-test skipped). Rollen-overzicht-flow regression-vrij — Module-seam transparante vervanger voor de directe RPC-call.
- **Demote = conceptueel, niet permissief**: omdat browser-callers `anon`/`authenticated` gebruiken kan een echte `REVOKE` niet zonder Module + `voorraadposities()` te breken. De `COMMENT`-tekst documenteert de design-intent: nieuwe code hoort de Module-seam te gebruiken.

**Bestanden touched**:
- [`supabase/migrations/187_oude_rpcs_cleanup.sql`](../supabase/migrations/187_oude_rpcs_cleanup.sql) — DROP + COMMENT-only-demote.
- [`frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts`](../frontend/src/modules/voorraadpositie/queries/ghost-besteld.ts) — nieuwe Module-query.
- [`frontend/src/modules/voorraadpositie/index.ts`](../frontend/src/modules/voorraadpositie/index.ts) — barrel-export uitgebreid.
- [`frontend/src/pages/rollen/rollen-overview.tsx`](../frontend/src/pages/rollen/rollen-overview.tsx) — directe RPC-call vervangen door `fetchGhostBesteldParen`.
- [`frontend/src/modules/voorraadpositie/__tests__/regression/fixture-10-ghost-besteld-paren.test.ts`](../frontend/src/modules/voorraadpositie/__tests__/regression/fixture-10-ghost-besteld-paren.test.ts) — 4 nieuwe testcases.
- [`docs/changelog.md`](changelog.md), [`docs/database-schema.md`](database-schema.md).

**HITL — migratie 187 handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Idempotent: `DROP FUNCTION IF EXISTS` + `COMMENT ON FUNCTION` zijn beide veilig her-uitvoerbaar.

## 2026-05-06 — Gewicht per kwaliteit — bron-van-waarheid op `kwaliteiten` (#38–#43)

Implementatie van de gewicht-per-kwaliteit feature, aangevraagd door Piet-Hein Dobbe — relevante info voor vervoerder (HST-pakbon `weightKg`). Plan: [`docs/superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md`](superpowers/plans/2026-05-06-gewicht-per-kwaliteit.md).

**Architectuur — Gewicht-resolver als deep SQL-Module:**
- Smal interface: `gewicht_per_m2_voor_kwaliteit`, `bereken_product_gewicht_kg`, `bereken_orderregel_gewicht_kg`.
- Brede implementatie: oppervlak-bepaling per producttype (vast/staaltje uit `lengte_cm × breedte_cm`, maatwerk uit `maatwerk_oppervlak_m2`), kwaliteit-density-lookup, NULL-fallback, trigger-cascade kwaliteit → producten → open order_regels.
- Alle gewicht-callers gaan voortaan hierdoor; bestaande `COALESCE(ore.gewicht_kg, p.gewicht_kg, 0)` in zending-aanmaak vervalt.

**Migraties:** _(originele nummers 180/181/182 hernummerd naar 184/185/186 wegens collisie met `180_voorraadposities_batch_filter` (T003) en `182_placeholder_rollen_opruim` (T004) op de feat/voorraadpositie-module-branch)_
- **184** — fundament: `kwaliteiten.gewicht_per_m2_kg` toegevoegd, `producten.lengte_cm`/`breedte_cm`/`gewicht_uit_kwaliteit` toegevoegd. Eenmalige regex-parsing van `karpi_code` (laatste 6 cijfers) vult lengte+breedte voor vaste en staaltje-producten.
- **185** — resolver-functies + cascade-triggers (`trg_kwaliteit_gewicht_recalc`, `trg_product_gewicht_recalc`) + modus-seed van `maatwerk_m2_prijzen.gewicht_per_m2_kg` naar `kwaliteiten` voor kwaliteiten zonder Excel-data. RPC `kleuren_voor_kwaliteit` leest gewicht voortaan uit `kwaliteiten`.
- **186** — cutover: hard reset van `order_regels.gewicht_kg` voor open orders, simplificatie van `create_zending_voor_order` (geen `p.gewicht_kg`-fallback meer), drop van `maatwerk_m2_prijzen.gewicht_per_m2_kg`.

**Frontend:**
- `berekenMaatwerkGewicht` → `berekenGewichtKg` verhuisd naar [`lib/utils/gewicht.ts`](../frontend/src/lib/utils/gewicht.ts). Importeurs: `op-maat-selector`, `kwaliteit-first-selector`.
- Nieuwe component [`<GewichtBronBadge>`](../frontend/src/components/kwaliteiten/gewicht-bron-badge.tsx) toont "uit oude bron"-badge op product-detail wanneer `producten.gewicht_uit_kwaliteit = false`.
- Nieuwe pagina `/instellingen/kwaliteiten` ([`pages/instellingen/kwaliteiten.tsx`](../frontend/src/pages/instellingen/kwaliteiten.tsx)) — sorteerbare tabel met inline-edit van gewicht-per-m², filters (alle/ontbreekt/ingevuld), banner met data-completing-status.
- Queries-bestand [`lib/supabase/queries/kwaliteiten.ts`](../frontend/src/lib/supabase/queries/kwaliteiten.ts) — `fetchKwaliteitenMetGewicht` + `updateKwaliteitGewicht`.
- Router-route + sidebar-item toegevoegd (`/instellingen/kwaliteiten`, icon `Scale`).

**Excel-import:**
- Bron: `brondata/voorraad/akwaliteitscodeslijst-260505.xlsx` — Karpi legacy-export (1049 kwaliteit-rijen, kolommen `Kwaliteitscode | Omschrijving | Gewicht per m2`). 1033 met geldig gewicht (1.25–25 kg/m², gemiddeld 2.29). 16 met 0.0 = niet-tapijt placeholder-codes (DIMV, MIXX, STAA etc.) → script behandelt als NULL.
- Script [`import/import_kwaliteit_gewichten.py`](../import/import_kwaliteit_gewichten.py) met `--dry-run` flag. Filtert no-op updates (huidige waarde = nieuwe waarde) zodat cascade-triggers niet onnodig firen. Onbekende codes → warning, niet fataal.

**Domeinwoordenboek toegevoegd:** Gewicht/m², Gewicht-resolver, Gewicht-cache, Gewicht-uit-kwaliteit-flag, Bbox-oppervlak (gewicht). Zie [`docs/data-woordenboek.md`](data-woordenboek.md).

**HITL — handmatig uit te voeren door Miguel:**
1. Migratie 184 + 185 apply'en op Karpi-Supabase (MCP heeft geen toegang, cf. memory).
2. `python import/import_kwaliteit_gewichten.py --dry-run` voor verificatie.
3. `python import/import_kwaliteit_gewichten.py` voor echte run.
4. Migratie 186 apply'en (cutover + cleanup).

## 2026-05-06 — Placeholder-rollen mig 112 + 113 opruim (T004 / #29)

Vierde slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Na T003's ghost-merge (rollen-overzicht toont (kw, kl)-paren zonder eigen voorraad via `besteld_per_kwaliteit_kleur` + view-laag-aanvulling) zijn de placeholder-rollen uit migraties 112 + 113 (oppervlak_m2=0, rolnummer 'PH-...') overbodig geworden. Ze waren een truc om "leeg-toch-zichtbaar"-paren te krijgen via de oude `fetchRollenGegroepeerd`-query, die in T003 is verwijderd.

- **Audit-bevindingen** — 0 frontend-hits voor `oppervlak_m2 = 0` of `rolnummer LIKE 'PH-%'`-filtering. Geen consumer leest meer specifiek op deze placeholder-shape:
  - RPC's mig 114 (`uitwisselbare_partners`), mig 115 (`rollen_uitwissel_voorraad`) en mig 137 (`besteld_per_kwaliteit_kleur`) filteren al expliciet op `oppervlak_m2 > 0`.
  - Mig 134 (`snijplanning_tekort_analyse`) sluit placeholders uit via `r.lengte_cm > 0 AND r.breedte_cm > 0`.
  - Mig 179 + 180 (`voorraadposities`) filtert eigen rollen op `oppervlak_m2 > 0`.
  - Edge-function `_shared/db-helpers.ts::fetchBeschikbareRollen` filtert PH-rollen al uit via `lengte <= 0 || breedte <= 0`. Defensieve filter blijft bestaan; mig 182 maakt hem hooguit nooit-true (geen breaking change).
- **Mig 182 — opruim** — `DELETE FROM rollen WHERE rolnummer LIKE 'PH-%' AND oppervlak_m2 = 0;`. Idempotent: bij re-run vindt DELETE 0 rijen.
- **Mig 112 + 113 INSERT-blok geneutraliseerd** — beide DO-blocks gewikkeld in `IF FALSE THEN ... END IF;`. RPC `rollen_uitwissel_voorraad()` in mig 112 (Deel 2) blijft intact — die wordt in T005 separaat gedemoteerd of gedropt na consumer-audit. Re-runs van mig 112/113 maken géén nieuwe PH-rollen meer aan.
- **Snijplanning + maatwerk-flow regression-vrij** — placeholders worden door alle bestaande filters al genegeerd. Rollen-overzicht ghost-groepen blijven verschijnen via de T003-ghost-merge.

**HITL — migraties 182 + de mig 112/113-updates handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Volgorde: eerst mig 182 (DELETE), daarna mig 112/113 herinladen (no-op INSERT's overschrijven oude logica). Op een DB die mig 112/113 nooit heeft gedraaid is mig 182 eveneens een no-op DELETE.

## 2026-05-06 — MaatwerkLevertijdHint via Voorraadpositie-Module (T002 / #27)

Derde slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). De maatwerk-levertijdhint cut-overt op de Module-seam zodat order-form, product-detail en rollen-overzicht alle drie via dezelfde `fetchVoorraadpositie`-call lezen.

- **`fetchMaatwerkLevertijdHint` migreert** — `frontend/src/lib/supabase/queries/op-maat.ts` regels 472–525. Vervangt de directe `supabase.rpc('besteld_per_kwaliteit_kleur')` + client-side `.find()` door één `await fetchVoorraadpositie(kw, kl)` uit `@/modules/voorraadpositie`. `besteld.eerstvolgende_verwacht_datum` wordt direct uit de Voorraadpositie gelezen i.p.v. uit een raw RPC-row. `app_config.order_config`-fetch en `iso_week_plus`-RPC-call ongewijzigd (buiten scope T002).
- **Nieuwe invariant — eigen voorraad blokkeert hint**: `voorraadpositie.voorraad.totaal_m2 > 0` ⇒ `{ status: 'geen_inkoop' }`. Reden: maatwerk kan direct uit voorraad gemaakt worden, dus een "wacht-op-inkoop"-melding is misleidend. Voorheen impliciet via caller-checks (snij-flow), nu expliciet in de hint-laag zelf.
- **Hint-tekst en weergave op orderregel ongewijzigd** — `MaatwerkLevertijdHint`-component (`frontend/src/components/orders/maatwerk-levertijd-hint.tsx`) ongemoeid; status-discriminator `inkoop_bekend | geen_inkoop` en signature van `fetchMaatwerkLevertijdHint` identiek aan main.
- **5 nieuwe vitest-tests** in `frontend/src/lib/supabase/queries/__tests__/op-maat.test.ts`: (a) ghost-paar → inkoop_bekend; (b) default-buffer 2 weken bij ontbrekende app_config; (c) geen voorraad én geen besteld → geen_inkoop; (d) eigen voorraad blokkeert hint ook als er besteld is; (e) `fetchVoorraadpositie` retourneert null → geen_inkoop. Mocks via `vi.mock('@/modules/voorraadpositie')` en `vi.mock('../../client')`.

Tests groen: 90/90 (85 → 90). Typecheck clean. Lint geen nieuwe errors.

## 2026-05-06 — Voorraadpositie-Module batch+filter + rollen-overzicht migratie (T003 / #28)

Tweede slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). De Module krijgt batch+filter-modus, de rollen-overzicht-pagina cut-overt 1-op-1 op het Voorraadpositie-concept, en de oude `fetchRollenGegroepeerd` + `RolGroep`-type verdwijnen.

- **SQL-RPC `voorraadposities()` uitgebreid** (mig 180) — drie modi: (a) single-paar (kw + kl beide gevuld) → exacte match incl. ghost-paren, ongewijzigd t.o.v. T001; (b) batch (beide leeg) → álle paren met eigen voorraad; (c) batch+filter (kw / kl / search los) → server-side filtering op kwaliteit (ILIKE-substring), kleur (exact na normalisatie), search (ILIKE op `kw-kl` of `producten.naam`). Bestaans-regel: batch retourneert ALLEEN paren met eigen voorraad — ghost-paren met enkel besteld worden expliciet uitgesloten en moeten door de caller gemerged worden. Nieuwe output-kolommen: `rollen JSONB` (per-rol details voor expand-rows: id, rolnummer, lengte, breedte, oppervlak, status, rol_type, locatie, oorsprong_rol_id, reststuk_datum, artikelnr, kwaliteit_code, kleur_code — gesorteerd `rol_type ASC, rolnummer ASC`); `product_naam TEXT` (uit `producten`-tabel); `eerstvolgende_m`/`eerstvolgende_m2` (vroegste leverweek aandeel — uit mig 137).
- **Module-uitbreiding** — `Voorraadpositie` heeft nu `rollen: RolRow[]` + `product_naam: string | null`; `BesteldInkoop` heeft `eerstvolgende_m` + `eerstvolgende_m2`; nieuwe `VoorraadpositieFilter`-interface; nieuwe `fetchVoorraadposities(filter)` + `useVoorraadposities(filter)`-hook met queryKey `['voorraadposities', 'batch', kw, kl, search]`. queryKey-conventie gedocumenteerd in JSDoc bovenaan `hooks/use-voorraadpositie.ts`.
- **Rollen-overzicht migratie** — `RollenGroepRow` consumeert `Voorraadpositie` direct (geen tijdelijke `toRolGroep`-adapter in main). `RollenOverviewPage` gebruikt `useVoorraadposities` voor de batch-call + een aparte `besteld_per_kwaliteit_kleur`-call voor ghost-paren-merge (view-laag-aanvulling op page-niveau). Visueel + functioneel ongewijzigd t.o.v. T001-baseline.
- **Cleanup** — `fetchRollenGegroepeerd` verwijderd uit `frontend/src/lib/supabase/queries/rollen.ts` (de paginated rollen-fetch + 4-RPC-merge-logic); `useRollenGegroepeerd` verwijderd uit `hooks/use-rollen.ts`; `RolGroep`-interface verwijderd uit `frontend/src/lib/types/productie.ts`. Let op: `RolGroep` in `lib/utils/snijplan-mapping.ts` en `components/snijplanning/snij-bevestiging-modal.tsx` is een **ander** concept (snijplan-rol-grouping) en blijft bestaan.
- **5 nieuwe regression-fixtures** (vitest) — invarianten 5 t/m 9: (5) partners-sortering m² DESC, kw ASC, kl ASC; (6) bestaans-asymmetrie batch vs single (ghost-paar zit in single, niet in batch); (7) leverweek-aggregatie vroegste verwacht_datum wint; (8) `partners` is altijd een array (nooit NULL); (9) batch-call met lege filter geeft alle params als `null` door, lege strings worden ook null. Bestaande T001-fixtures aangepast om de nieuwe veld-shapes te tolereren.
- **Performance-baseline** — `__tests__/performance.test.ts` (skip-by-default via `VITEST_INCLUDE_PERF=1`) documenteert de strategie: seed Supabase test-branch met ~5000 rollen + ~200 IO-regels, run `fetchVoorraadposities({})` 10×, asserteer p95 < 500 ms. Implementatie als HITL-vervolg.

**HITL — migratie 180 nog handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Tot dan retourneert `fetchVoorraadposities` een lege array met een warn-log; rollen-overzicht valt netjes terug op de ghost-merge zodat de "alleen besteld"-paren in elk geval zichtbaar blijven (zij het zonder eigen-voorraad-lijst).

## 2026-05-06 — QA-fixes order-voorstel epic (sub-issues van #17)

Vier UI-bugs gevonden tijdens handmatige QA-walkthrough van issue #17, met losse sub-issues geïsoleerd en gefixt.

- **#34 — Sortering orders-overzicht**: `fetchOrders` had geen secundaire sort, dus binnen dezelfde `orderdatum` kon de meest recente order op willekeurige plek belanden. `id DESC` toegevoegd als tiebreaker (id is auto-increment → monotoon stijgend → perfect proxy voor aanmaakvolgorde). Geen migratie nodig.
- **#32 — Maatwerk-regel zonder voorraad én zonder inkoop**: `fetchMaatwerkLevertijdHint` returnde `null` wanneer er geen openstaande inkoop was → component verbergde zichzelf → gebruiker zag niets. Discriminated-union-result `inkoop_bekend | geen_inkoop`; bij `geen_inkoop` toont de hint nu een amber-waarschuwing "Niet op voorraad — geen lopende inkoop bekend. Levertijd onbekend." zodat de gebruiker niet stilzwijgend een onleverbare regel toevoegt.
- **#33 — Verzendkosten + maatwerk-levertijd bij split-order (deelleveringen aan)**:
  - Verzendkosten gingen altijd naar het standaard- (resp. directe-) deel. Nu naar het **duurste** sub-totaal (gemixt-split én IO-split).
  - Maatwerk-deel gebruikte de statische `maatwerk_weken`-config (default 4 weken, klant-override mogelijk 1) → kreeg "+1 week" terwijl echte capaciteit 15 weken kan zijn. Nieuwe helper `berekenMaatwerkAfleverdatumViaSeam` roept de echte planning-seam (`check-levertijd`) aan voor élke maatwerk-regel met complete data en neemt de **MAX lever_datum** als afleverdatum van de maatwerk-sub-order. Fallback op de oude statische berekening voor onvolledige regels.
- **#35 — Uitwisselbaar-zichtbaarheid + prijslijst-fallback**:
  - In de voorraad-cel van `OrderLineEditor` verschijnt nu een passieve `(+N via ander type)`-indicator zodra er uitwisselbare voorraad bestaat — ongeacht tekort. Voorheen moest de gebruiker het orderaantal eerst boven de eigen voorraad drukken om dat te zien.
  - Nieuwe `prijs_uit_prijslijst`-flag op `OrderRegelFormData` (display-only). Bij prijs-fallback (klant heeft prijslijst, maar artikel staat er niet in) toont de prijs-cel "⚠ Niet uit prijslijst" — gebruiker weet dat hij een fallback-prijs gebruikt en kan handmatig corrigeren.

Tests groen: 13 testfiles, 74 tests. Typecheck clean. Lint geen nieuwe errors (6 pre-existing onveranderd).

## 2026-05-06 — Voorraadpositie-Module tracer-bullet (T001 / #26)

Eerste slice van de Voorraadpositie-Module-epic ([PRD #25](https://github.com/Miguel-AIProgression/karpi-erp/issues/25)). Levert één deep TS-Module rond het concept "Voorraadpositie per (kwaliteit, kleur)" + één SQL-RPC als seam. Past binnen [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md) — geen aparte ADR.

- **SQL-RPC `voorraadposities(p_kwaliteit, p_kleur, p_search)`** (mig 179) — single-paar-modus volledig werkend. Retourneert per (kw, kl) eigen voorraad (volle/aangebroken/reststuk + m²), uitwisselbare partners (gesorteerd m² DESC), `beste_partner` (alleen wanneer eigen_m²=0 én partners[0].m²>0 — invariant 1), en besteld-aggregatie. Bouwt op bestaande RPC's `uitwisselbare_partners()` (mig 115) en `besteld_per_kwaliteit_kleur()` (mig 137). Kleur-normalisatie (`'15.0' → '15'`) via één `regexp_replace`. Single-call retourneert ook ghost-paren (FULL OUTER JOIN tussen eigen, partners en besteld). T003 (#28) breidt uit met batch+filter-modus.
- **Module `frontend/src/modules/voorraadpositie/`** met `types.ts`, `queries/voorraadposities.ts` (`fetchVoorraadpositie`), `hooks/use-voorraadpositie.ts`, `lib/normaliseer-kleur.ts` en barrel-export. queryKey-conventie `['voorraadpositie', kw, kl]`, staleTime 60 s. Lege string voor kw of kl → `null` zonder Supabase-call.
- **Product-detail-pagina** consumeert `useVoorraadpositie` voor de "Openstaande inkooporders"-sectie-totaal (m¹). De per-IO-regel-detail (leverancier, status, leverweek per regel) blijft uit `useOpenstaandeInkoopVoorArtikel` komen — die data zit niet in het aggregate. Visueel + functioneel ongewijzigd t.o.v. main; de `voorraadpositie?.besteld?.besteld_m` heeft een fallback op de regel-sum zodat de UI ook zonder mig 179 deployment correct blijft tonen.
- **4 regression-fixtures** (vitest) in `frontend/src/modules/voorraadpositie/__tests__/regression/` bewaken de invarianten: (1) eigen blokkeert beste_partner; (2) symmetrie partners; (3) kleur-normalisatie + lege-string-guard zonder rpc-call; (4) `besteld_m2 = 0` (niet null) bij ontbrekende standaard_breedte_cm.

**HITL — migratie 179 nog handmatig toepassen op Supabase Karpi-project** (MCP heeft geen toegang). Tot dan retourneert `fetchVoorraadpositie` `null` met een warn-log; de product-detail-pagina valt netjes terug op de regel-sum-berekening voor het sectie-totaal.

## 2026-05-05 — Pick-ship gesplitst naar `modules/magazijn/` + uitbreiding `modules/logistiek/`

Pick-ship-folder bevatte drie verschillende concerns (pickbaarheid, vervoerder-selectie, zending-creatie) in een flat-namespace. Heringericht volgens [ADR-0002](adr/0002-pick-ship-splitst-naar-magazijn-en-logistiek.md).

- **`modules/magazijn/`** is de derde deep verticale Module (na orders + planning). Bezit pickbaarheid, pick-buckets, locatie-mutaties op rollen + snijplannen, magazijn-locaties-tabel, pick-overview-pagina (route `/pick-ship` blijft), `OrderPickCard`. Smal publiek oppervlak via barrel — pure helpers blijven privé.
- **`modules/logistiek/`** uitgebreid met `<VerzendsetButton>` en `useActieveVervoerder()`-hook. `<VervoerderTag>` is voortaan self-fetching wanneer geen `code`-prop wordt gegeven (slot-pattern in pick-context).
- **Atomiciteitsbug locatie-update opgelost**: nieuwe RPC `set_locatie_voor_orderregel` (mig 0183) bundelt `INSERT magazijn_locaties ON CONFLICT` + `UPDATE snijplannen.locatie` in één transactie. Voorkomt dangling rijen wanneer de tweede call faalt.
- Contract-test `magazijn-pickbaarheid.contract.test.ts` bewaakt vier `fetchPickShipOrders`-scenario's (view + N regels, view + 0 regels, view ontbreekt → fallback, header-only).
- `architectuur.md` documenteert nu het slot-pattern en atomic-RPC-pattern als bewuste designkeuzes.

Issues #20-#24 (epic:magazijn-module). Geen DB-schema-migratie naar FK voor `snijplannen.locatie` — V2.

## 2026-05-05 — Architectuurplan: Order-voorstel + Planning als deep verticale Modules

Architectuur-grilling-sessie heeft de order-intake-flow geanalyseerd en als deepening-kandidaat geïdentificeerd: zes lagen (order-form → line-editor → uitwisselbaar-hint → levertijd-suggestie → claim-RPC's → DB) die één logisch domeinconcept (`Order-voorstel`) verdelen.

- **Beslissing**: Order-voorstel + Planning worden twee aparte deep verticale Modules met een TS-functie-contract als seam — vastgelegd in [ADR-0001](adr/0001-order-voorstel-en-planning-als-twee-modules.md).
- **Plan**: zie [`2026-05-05-order-voorstel-en-planning-modules.md`](superpowers/plans/2026-05-05-order-voorstel-en-planning-modules.md) voor scope, module-grenzen, save/read-paths, migratie-aanpak (big-bang in worktree met regression-snapshot), en test-strategie (contract-tests op de seam, regression-snapshot op 20 representatieve order-fixtures).
- **`data-woordenboek.md`**: nieuwe term `Order-voorstel` toegevoegd (parallel aan `Snijvoorstel`); verwijst naar ADR-0001.
- **`architectuur.md`**: nieuwe subsectie "Module-grafiek (vertical slices met expliciete seams)" als anker-beslissing.

Pick-ship blijft uit scope (eigen Module in latere migratie); `<LevertijdSuggestie>` verhuist naar Planning-Module; `maatwerk-prijs.ts` valt onder Orders-Module.

Uitvoering nog niet gestart — eerstvolgende stap is het genereren van de regression-fixture-set.

---

## 2026-05-01 — Nieuw-product-formulier: auto artikelnr/karpi-code, maatwerk-afwerking, voorraad-lock

[`ProductCreatePage`](../frontend/src/pages/producten/product-create.tsx) heeft drie kwaliteitsverbeteringen gekregen die het aanmaakproces afstemmen op de Karpi-conventies:

- **Artikelnummer auto-doornummeren.** Nieuwe query [`fetchNextArtikelnr`](../frontend/src/lib/supabase/queries/producten.ts) bepaalt het volgende 9-cijferige artikelnr op basis van `MAX(artikelnr) + 1` binnen de karpi_code-prefix `{kwaliteit}{kleur}` (bijv. `FAMU48` → 298480000…298480003 → suggestie `298480004`). Fallbacks: zelfde kleurcode-range als kwaliteit+kleur leeg is, anders globale max +1, anders `298000000`. Per variant-rij telt het nummer op (rij 0 = base, rij 1 = base+1, etc.). Veld blijft editable; manuele wijziging schakelt auto-suggestie voor die rij uit.
- **Karpi-code auto-genereren.** Nieuwe `buildKarpiCode`-helper produceert het format `{KWALITEIT}{KLEUR:2}XX{BREEDTE:3}{LENGTE:3 of "RND"}` zodra kwaliteit, kleur, breedte en lengte ingevuld zijn — zelfde conventie als `parse_karpi_code` in `import/sync_rollen_voorraad.py`. Manuele override blijft mogelijk.
- **Maatwerk-afwerking in stamgegevens.** Nieuw selectveld in de stamgegevens-sectie toont `afwerking_types` (B, FE, LO, ON, SB, SF, VO, ZO). Bij opslaan wordt de waarde geüpsert in `maatwerk_afwerking_per_kleur` als zowel kwaliteit als kleur gezet zijn (per-kleur override), anders in `kwaliteit_standaard_afwerking` (kwaliteit-default). Bij heropenen wordt de bestaande waarde voor (kwaliteit, kleur) voorgevuld via `fetchAfwerkingVoorKleur` → `fetchStandaardAfwerking`. Nieuwe helper [`setAfwerkingVoorKleur`](../frontend/src/lib/supabase/queries/op-maat.ts).
- **Voorraad locked op 0 + actief default false.** Voorraadveld in de variantentabel is read-only/disabled (visueel gegrijst) — voorraad ontstaat pas via boek-ontvangst op de inkooporder. De `Actief`-checkbox staat standaard uit met uitleg ("pas zichtbaar zodra de eerste inkoop is ontvangen"), aansluitend bij de werkflow: product aanmaken → IO maken → ontvangen → activeren.

Geen migratie nodig — alle gebruikte tabellen (`afwerking_types`, `kwaliteit_standaard_afwerking`, `maatwerk_afwerking_per_kleur`) bestonden al.

---

## 2026-05-01 — Debiteuren gekoppeld aan nieuwe prijslijsten 0210 / 0211

Op basis van twee Excel-exports uit het oude systeem (`klantenbestand prijslijst 150.xlsx` met 644 debiteuren en `klantenbestand prijslijst 151.xlsx` met 183 debiteuren) zijn de actuele klantkoppelingen in `debiteuren.prijslijst_nr` bijgewerkt: lijst 150 → `0210` (BENELUX PER 01.04.2026), lijst 151 → `0211` (BENELUX INCL. MV PER 01.04.2026). De 0211-debiteuren stonden al gekoppeld vanuit `prijslijst_update_2026.py`; de 642 0210-debiteuren stonden op `NULL` en zijn nu bijgewerkt. Twee debiteuren ontbraken nog volledig in de DB en zijn alsnog aangemaakt op basis van de Excel-bron (incl. `afleveradres adres_nr=0` en koppeling aan `0210`): `301009 SARAH COUMANS INTERIEURONTWERP` (NL, Astrid Roth) en `570004 MEUBLETA` (BE, Siemen Esprit). Eindstand: prijslijst `0210` = 644 debiteuren, `0211` = 184 debiteuren. Script: [`import/koppel_debiteuren_prijslijst_2026_05.py`](../import/koppel_debiteuren_prijslijst_2026_05.py) — idempotent, slaat reeds-correcte koppelingen over.

---

## 2026-05-01 — Productzoek in order matcht klant-eigen kwaliteitsnamen

Klanten plaatsen vaak bestellingen onder hun eigen kwaliteitsnaam (bijv. "BREDA") in plaats van de Karpi-code (`BEAC`). Het zoekveld in `KwaliteitFirstSelector` (zichtbaar als "Zoek kwaliteit..." in [`OrderLineEditor`](../frontend/src/components/orders/order-line-editor.tsx)) gebruikt nu — zodra een klant geselecteerd is — óók `klanteigen_namen.benaming` en `klanteigen_namen.omschrijving` als zoekbron. Klant-eigen matches verschijnen bovenaan de resultatenlijst met een blauwe `· klant: <naam>`-hint, zodat de orderintake-medewerker direct ziet waarom een kwaliteit gevonden werd op een term die niet in de Karpi-omschrijving voorkomt.

Daarnaast filtert het zoekveld nu strikter wanneer de zoekterm óók een kleurcode bevat (bijv. `ross 55`): kwaliteiten zonder een actief product met die kleurcode vallen af. Voorheen verscheen LAGO bij "ross 55" omdat de klant-eigen naam ROSS matchte, terwijl LAGO geen kleur 55 voert. Kleurcodes worden vergeleken met en zonder `.0`-suffix.

Aanpassingen: [`searchKwaliteitenViaProducten`](../frontend/src/lib/supabase/queries/op-maat.ts) accepteert optioneel `debiteurNr` + `kleurHint`, query't `klanteigen_namen` parallel, en doet bij kleurHint een tweede `producten`-query om de kandidaat-kwaliteiten te filteren op werkelijke kleurbeschikbaarheid; `KwaliteitOptie` heeft nieuw veld `klant_eigen_naam`. [`KwaliteitFirstSelector`](../frontend/src/components/orders/kwaliteit-first-selector.tsx), [`OrderLineEditor`](../frontend/src/components/orders/order-line-editor.tsx) en [`OrderForm`](../frontend/src/components/orders/order-form.tsx) reiken `debiteur_nr` van `client` door. Geen migratie nodig — de tabel `klanteigen_namen` bestond al sinds V1-import.

---

## 2026-05-01 — Migratie 178: documenten-bijlagen bij orders en inkooporders

Gebruikers kunnen nu PDF/JPG/PNG/Excel/Word/TXT-bijlagen koppelen aan zowel verkooporders (klant-PO, bevestiging) als inkooporders (orderbevestiging leverancier, pakbon, factuur). Migratie 178 voegt twee tabellen toe (`order_documenten`, `inkooporder_documenten`, beide met `ON DELETE CASCADE` op de parent + RLS voor `authenticated`) en één gedeelde private storage-bucket `order-documenten` met paden `orders/{order_id}/...` en `inkooporders/{inkooporder_id}/...`. Bucket-limiet: 25 MB per bestand, expliciete `allowed_mime_types`.

Frontend: gedeelde `<DocumentenSectie>` component (drag-drop + signed-URL preview + omschrijving inline editen + delete) plus `<DocumentenBuffer>` voor de order-create-flow waar nog geen `order_id` bestaat — buffert files lokaal en uploadt ze in `OrderForm.onAfterCreate` na succesvolle save (bij split-orders gekoppeld aan beide order-id's). Inpassingen op `inkooporder-detail.tsx`, `order-detail.tsx`, `order-edit.tsx`, `order-create.tsx`. Centrale queries in `lib/supabase/queries/documenten.ts` en hooks in `hooks/use-documenten.ts` (één set, parameteriseerbaar via `kind: 'order' | 'inkooporder'`).

---

## 2026-05-01 - Pick & Ship verzendset met stickers en pakbon

Pick & Ship heeft nu per volledig pickbare order een **Verzendset**-actie. De actie maakt/hergebruikt een `zendingen`-rij via `create_zending_voor_order`, kiest automatisch de vervoerder uit `edi_handelspartner_config.vervoerder_code`, en opent `/logistiek/:zending_nr/printset` met printbare colli-stickers en A4-pakbon. Stickers tonen afleveradres, vervoerder, colli-volgnummer en GS1-128/SSCC-barcode; de pakbon toont orderregels, besteld/geleverd, afleveradres, colli en gewicht.

Migratie 177 scherpt `create_zending_voor_order` definitief aan nadat `176_zending_vervoerder_auto_selectie` de RPC opnieuw overschreef: gebruikt `order_regels.orderaantal` in plaats van de niet-bestaande kolom `aantal`, vult `zending_regels.aantal`, `zendingen.aantal_colli` en `zendingen.totaal_gewicht_kg` voor de printflow.

---

## 2026-05-01 - Vervoerders achter Logistiek-instellingen

Het losse sidebar-item "Vervoerders" is verwijderd. Vervoerderbeheer blijft beschikbaar via de instellingenknop rechtsboven op het Logistiek-overzicht (`/logistiek`), zodat de operationele navigatie compacter blijft en de routes `/logistiek/vervoerders` en `/logistiek/vervoerders/:code` intact blijven.

---

## 2026-05-01 - Pick & Ship toont open orders met fallback

Pick & Ship leest nu standaard alle open orders (`status != Verzonden/Geannuleerd`) in plaats van alleen regels die al als pickbaar zijn gemarkeerd. Als de database-view `orderregel_pickbaarheid` nog niet is toegepast of nog niet in de Supabase schema-cache zit, valt de frontend terug op `orders` + `order_regels`, zodat de pickpagina niet leeg blijft. Orderkaarten tonen nu ook de orderstatus.

---

## 2026-05-01 — Migratie 175: HST-instellingen seed

Vult `vervoerders`-rij voor `hst_api` met `api_endpoint` (acceptatie-host), `api_customer_id` (`038267`), contactpersoon (Niek Zandvoort, n.zandvoort@hst.nl) en uitgebreide `notities` op basis van e-mailcorrespondentie 2026-02-26 t/m 2026-03-02. `actief` blijft `FALSE` tot na succesvolle cutover-test (Fase 4 van het HST-API-plan).

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md).

---

## 2026-05-01 — Migratie 174: vervoerder-instellingen + stats-view

Uitbreiding `vervoerders`-tabel met 7 kolommen voor instellingen, contactgegevens en tarief-notities (vrije tekst V1): `api_endpoint`, `api_customer_id`, `account_nummer`, `kontakt_naam`, `kontakt_email`, `kontakt_telefoon`, `tarief_notities`. Nieuwe view `vervoerder_stats` voor dashboard-pages (aantal klanten, zendingen totaal/deze-maand, HST success/fail-counts). Frontend `/logistiek/vervoerders` overzicht + detail-pagina onder `frontend/src/modules/logistiek/`.

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md`](superpowers/plans/2026-05-01-logistiek-vervoerder-instellingen.md) (Fase A; B = gestructureerde tarieven, C = auto-selectie blijven roadmap).

---

## 2026-05-01 — Migratie 169: zendingen-tabel

Eerste werkelijke materialisatie van `zendingen` + `zending_regels` (stond al in schema-doc beschreven, maar nog nooit aangemaakt). Inclusief enum `zending_status` (Gepland, Picken, Ingepakt, Klaar voor verzending, Onderweg, Afgeleverd), `created_at`/`updated_at` met trigger, RLS, en lazy `volgend_nummer('ZEND')`-sequence voor `ZEND-2026-0001`. Voorbereiding op logistiek-module HST API-koppeling.

Plan: [`docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md`](superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md).

---

## 2026-05-01 — Migratie 170: vervoerders + per-debiteur vervoerderkeuze

Nieuwe `vervoerders`-lookup-tabel met 3 zaad-rijen (`hst_api`, `edi_partner_a` Rhenus, `edi_partner_b` Verhoek — alle drie default `actief=FALSE`). Plus nieuwe kolom `edi_handelspartner_config.vervoerder_code` (FK → `vervoerders.code`) voor per-debiteur routing. Géén automatische re-routing van openstaande zendingen bij wisseling — alleen nieuwe zendingen volgen de nieuwe waarde.

---

## 2026-05-01 — Migratie 171: hst_transportorders + adapter-RPCs

HST-adapter-implementatie. Eigen tabel `hst_transportorders` met HST-specifieke kolommen (`extern_transport_order_id`, `extern_tracking_number`, `request_payload`, `response_payload`, `response_http_code`, retry/status, `is_test`). Nieuwe enum `hst_transportorder_status` (Wachtrij, Bezig, Verstuurd, Fout, Geannuleerd). Vier RPC's: `enqueue_hst_transportorder`, `claim_volgende_hst_transportorder`, `markeer_hst_verstuurd`, `markeer_hst_fout`. Idempotentie via partial unique index `uk_hst_to_zending_actief` (één actieve transportorder per zending, retry zet oude rij eerst op `Geannuleerd`).

Géén gegeneraliseerde `vervoerder_berichten`-tabel — verticale slice voor HST. Toekomstige EDI-vervoerders hergebruiken straks de bestaande `edi_berichten`-tabel met `berichttype='verzendbericht'`. Reden: deletion-test wijst uit dat een gegeneraliseerde queue-tabel shallow zou zijn (interface bijna net zo complex als de twee implementaties).

---

## 2026-05-01 — Migratie 172: switch-RPC + zending-trigger

Nieuwe RPC `create_zending_voor_order(p_order_id)` (idempotent — returnt bestaande actieve zending of maakt nieuwe rij + bijbehorende `zending_regels` met status direct `'Klaar voor verzending'`). Nieuwe **single-switch-point** RPC `enqueue_zending_naar_vervoerder(p_zending_id)` als enige plek in de codebase waar op `vervoerder_code` wordt gedispatcht naar de adapter-RPC (`'hst_api'` → `enqueue_hst_transportorder`; toekomstige `'edi_partner_a/b'` → `enqueue_edi_verzendbericht`). Plus AFTER INSERT/UPDATE OF status-trigger `trg_zending_klaar_voor_verzending` op `zendingen` die bij transitie naar `'Klaar voor verzending'` de switch-RPC aanroept. Trigger weet niets over HST/EDI — alle vervoerder-onderscheid leeft in de switch.

---

## 2026-05-01 — Migratie 173: hst-send pg_cron schedule

Edge function `hst-send` draait elke minuut via pg_cron. Claimt rijen uit `hst_transportorders` (status `Wachtrij`), bouwt HST TransportOrder-payload (lokale builder in [`supabase/functions/hst-send/payload-builder.ts`](../supabase/functions/hst-send/payload-builder.ts)), POST'st naar `https://accp.hstonline.nl/rest/api/v1/TransportOrder` met HTTP Basic-auth, schrijft response + tracking terug via `markeer_hst_verstuurd` of retry/fout via `markeer_hst_fout`. Cutover blijft op ACCP-omgeving; productie-credentials volgen apart.

---

## 2026-05-01 - EDI-orderprijzen uit debiteurprijslijst

EDI-orders `ORD-2026-2022` en `ORD-2026-2023` kwamen correct binnen qua artikelen, maar hadden `€0,00` omdat `create_edi_order` alleen `producten.verkoopprijs` gebruikte. Voor BDSK/LUTZ PATCH-artikelen is die productprijs leeg; de juiste prijs staat in prijslijst `0201`.

- **Data-correctie:** legacy BDSK-debiteuren `600553`, `600554` en `600555` zijn gekoppeld aan LUTZ-prijslijst `0201`; `ORD-2026-2022` en `ORD-2026-2023` zijn herprijsd naar totaal `€56,49` (`29,73 + 13,38 + 13,38`).
- **Migratie 166:** [`166_edi_prijzen_uit_prijslijst.sql`](../supabase/migrations/166_edi_prijzen_uit_prijslijst.sql) herdefinieert `create_edi_order` zodat EDI-regels eerst uit `debiteuren.prijslijst_nr -> prijslijst_regels` worden geprijsd, met fallback op `producten.verkoopprijs`.
- **Frontend-vangnet:** handmatige EDI-upload en demo-flow kiezen bij dubbele GLN's voortaan eerst een actieve debiteur met prijslijst en herprijzen de aangemaakte order direct na de RPC-call.
- **Backfill:** dezelfde migratie vult bestaande EDI-orderregels zonder prijs bij waar een prijslijstprijs bestaat.

---

## 2026-05-01 - aanvullende prijslijsten geimporteerd en gekoppeld

De nieuwe ZIP-bestanden `prijslijsten.zip` en `toevoegingprijslijsten.zip` zijn verwerkt naar Supabase.

- **Import tooling:** toegevoegd: [`import/prijslijsten_aanvulling_manifest.json`](../import/prijslijsten_aanvulling_manifest.json) en [`import/import_prijslijsten_aanvulling.py`](../import/import_prijslijsten_aanvulling.py). Het script draait standaard als dry-run en schrijft rapporten onder `import/rapporten/`.
- **Koppellogica:** debiteuren worden gekoppeld via de oude `Prijslijst`-kolom in [`brondata/debiteuren/Karpi_Debiteuren_Import.xlsx`](../brondata/debiteuren/Karpi_Debiteuren_Import.xlsx), met expliciete validatie voor Porta (`630859`, `630861`, `630862`) en LUTZ (`600556`, `600562`, `600571`, `600572`) uit de mail.
- **Supabase-resultaat:** 14 prijslijsten geupsert, 13.627 prijslijstregels geupsert, 227 debiteuren gekoppeld en 6 ontbrekende producten minimaal aangemaakt.
- **Nacontrole:** idempotentie-dry-run na import gaf 0 nieuwe producten, 0 waarschuwingen en 0 blokkerende problemen.

---

## 2026-04-30 — EDI vertical-module + berichttype-registry + klantconfiguratie UI

Twee architectuurkeuzes uit `/improve-codebase-architecture`-review samengebracht met de geplande klant-config-UI.

- **Vertical-module:** `frontend/src/lib/edi/`, `frontend/src/pages/edi/`, `frontend/src/components/edi/`, `frontend/src/lib/supabase/queries/edi.ts` en `frontend/src/hooks/use-edi.ts` zijn samengevoegd onder [`frontend/src/modules/edi/`](../frontend/src/modules/edi/) (sub-folders `pages/`, `components/`, `hooks/`, `queries/`, `lib/`). Externe consumers importeren via de barrel `@/modules/edi`.
- **Berichttype-registry:** [`registry.ts`](../frontend/src/modules/edi/registry.ts) is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`, `verzendbericht`) — code, richting, UI-label, UI-subtitle, `configToggleKey`, `relatedEntity`, `transusProcess`. Frontend itereert over `getBerichttypenVoorRichting(...)`. Backend (poll/send edge functions) blijft V1 op huidige switch — registry-spiegel volgt in een follow-up plan.
- **EDI-klantconfiguratie UI** — klant-detail krijgt EDI-tab met de processen uit de registry (Inkomend/Uitgaand gegroepeerd) + test-modus + notities. Klanten-overzicht krijgt EDI-filter (Alle / EDI / Niet-EDI) en EDI-tag op klantkaart + detail-header. Schrijft naar bestaande `edi_handelspartner_config` (mig 156). UI: [klant-edi-tab.tsx](../frontend/src/modules/edi/components/klant-edi-tab.tsx), [edi-tag.tsx](../frontend/src/modules/edi/components/edi-tag.tsx). Geen migratie nodig.

---

## 2026-04-30 - EDI/Transus facturen via Karpi fixed-width INVOIC

Uitgaande facturen kunnen nu als Transus INVOIC-bericht in de EDI-wachtrij worden gezet. Het nieuwe BDSK-voorbeeld `Bericht-ID 168849861.zip` is toegevoegd als fixture en gebruikt om de byte-layout van Karpi's fixed-width factuurformaat te verankeren.

- **Edge/shared:** nieuwe builder `supabase/functions/_shared/transus-formats/karpi-invoice-fixed-width.ts` maakt 1107-byte headerregels en 312-byte artikelregels voor Transus' Custom ERP INVOIC-formaat.
- **Factuurflow:** `supabase/functions/factuur-verzenden/index.ts` queue't bij `edi_handelspartner_config.transus_actief=true` en `factuur_uit=true` automatisch een `edi_berichten`-rij (`berichttype='factuur'`, `status='Wachtrij'`). E-mail blijft mogelijk naast EDI, maar is niet meer verplicht voor EDI-only debiteuren.
- **Fixtures/tests:** toegevoegd: `factuur-uit-bdsk-168849861.txt`, `edifact-output-invoic-bdsk-168849861.edi` en unit-testdekking voor beide BDSK-factuurvoorbeelden plus RugFlow-nummernormalisatie.
- **Docs:** architectuur, data-woordenboek en Transus voorbeeld-README bijgewerkt zodat het verschil duidelijk is: orderbevestigingen gaan als TransusXML, facturen als Karpi fixed-width INVOIC.

---

## 2026-04-30 — BTW-verlegd-flag voor intracommunautaire EU-debiteuren

Eerste echte BDSK round-trip in Transus' "Bekijken en testen" leverde een **structureel correcte EDIFACT D96A `ORDRSP`** op — alle GLN's, datums en LIN-segmenten matchen het origineel `edifact-output-ordrsp-bdsk-168911805.edi`. Eén productie-blokker bleef over: `<VATPercentage>21</VATPercentage>` ipv `0` (BDSK is intracommunautair B2B → BTW-verlegd).

- **Migratie 164** ([`164_btw_verlegd_intracom.sql`](../supabase/migrations/164_btw_verlegd_intracom.sql)):
  - Nieuwe kolom `debiteuren.btw_verlegd_intracom BOOLEAN DEFAULT FALSE`.
  - Conservatieve backfill — zet TRUE voor debiteuren met `land` in een herkenbare EU-non-NL lidstaat (DE, BE, FR, AT, IT, ES en ~20 andere; varianten incl. landcode + voluit-naam).
  - Partial index `idx_debiteuren_btw_verlegd_intracom` voor snelle filtering.
- **Frontend** ([`download-orderbev-xml.ts`](../frontend/src/lib/edi/download-orderbev-xml.ts)):
  - Query haalt `btw_verlegd_intracom` mee uit `debiteuren`.
  - Als flag=TRUE → `vatPercentage = 0`, anders fallback naar `btw_percentage` (default 21%).
- **Format-validatie BDSK orderbev:** in deze test bewezen dat `<OrderResponseNumber>ORD-2026-20200001</...>` (alfanumeriek) wordt geaccepteerd, en dat Karpi-artikelnrs in `<ArticleCodeSupplier>` (i.p.v. Basta-legacy `PATS23XX080150`) ook werken zolang GTIN klopt.
- **Auto-memory bijgewerkt:** `project_edi_transus` legt vast dat TransusXML voor BDSK orderbev werkt + alle BDSK-GLN-rollen.

---

## 2026-04-30 - EDI/Transus orderbevestiging technisch cutover-ready gemaakt

De handmatige round-trip-flow is doorgetrokken naar de echte queue/send-kant: orderbevestigingen worden nu als TransusXML in `edi_berichten.payload_raw` gezet, bestaande wachtrij-rijen met het oude fixed-width formaat worden omgezet zolang ze nog niet verstuurd zijn, en de nieuwe `transus-send` edge function verstuurt wachtrij-payloads via M10100.

- **Frontend:** `download-orderbev-xml.ts` gebruikt nu de echte orderkolommen (`order_nr`, `klant_referentie`, `besteller_gln`, `factuuradres_gln`, `afleveradres_gln`) en haalt BTW via `debiteuren.btw_percentage`; `bevestig-helper.ts` bouwt/queue't TransusXML met `order_response_seq`.
- **Edge:** gedeelde fixed-width parser accepteert Transus-regels met afgekapte trailing spaces; `transus-poll` schrijft M10300 ack-resultaten terug naar `ack_status`/`acked_at`; `transus-send` claimt en verstuurt uitgaande berichten via M10100.
- **Waarom:** de eerdere build faalde en de echte M10110-parser/send-flow liep nog niet gelijk met de bewezen BDSK TransusXML-rondreis.

---

## 2026-04-30 — producten.ean_code cleanup (`.0`-suffix) + tolerante EDI-matching

Fix voor data-quality issue dat tijdens de eerste echte BDSK-upload aan het licht kwam: `producten.ean_code` bevatte consistent een trailing `.0` (bv. `8715954176023.0`), erfenis van een Excel-import die GTIN's als FLOAT las. Hierdoor matchte de EDI-`match_edi_artikel`-RPC nooit op echte GTIN's uit Transus-berichten en vielen alle inkomende EDI-orderregels terug op `[EDI ongematcht]`.

- **Migratie 162** ([`supabase/migrations/162_producten_ean_code_cleanup.sql`](../supabase/migrations/162_producten_ean_code_cleanup.sql)):
  - Eenmalige `UPDATE` strijkt `.0`-suffix weg op alle bestaande rijen.
  - Nieuwe `BEFORE INSERT OR UPDATE`-trigger `producten_normaliseer_ean_code` strijkt `.0` + whitespace bij elke schrijfactie — voorkomt herhaling bij volgende imports.
  - `match_edi_artikel` uitgebreid met defensieve fallback (1b: probeert ook `p_gtin || '.0'`) als safety net mocht de trigger ooit niet gevuurd hebben.
- **Scope:** ~25.000 producten met `.0`-suffix, geen schade aan numeriek-correcte rijen.
- **Diagnose:** klant 8MRE0 op BDSK had drie GTIN's (`8715954176023`, `218143`, `235829`) die wel in `producten` stonden, maar onder Karpi's interne artikelnrs (`526230180`, `526920010`, `526100024`) — niet onder de Basta-legacy nummering `PATS23XX080150` etc. die in oude orderbev-XML's staat.

---

## 2026-04-30 — EDI handmatige upload/download voor round-trip-validatie

Nieuwe knop **"Bestand uploaden"** op [`/edi/berichten`](../frontend/src/pages/edi/berichten-overzicht.tsx) waarmee echte `.inh`-bestanden uit Transus' archief kunnen worden geüpload, geparseerd en verwerkt zonder dat de M10110 SOAP-poll actief hoeft te zijn. Op uitgaande orderbev-berichten staat een nieuwe **"TransusXML"-download-knop** die een `<ORDERRESPONSES>`-XML on-the-fly bouwt uit `orders` + `order_regels` — dat bestand kan in Transus' "Bekijken en testen"-tab worden geüpload om de partner-format-validatie te testen.

- **Plan:** [`docs/superpowers/plans/2026-04-30-edi-handmatige-upload-download.md`](superpowers/plans/2026-04-30-edi-handmatige-upload-download.md).
- **Nieuwe modules:**
  - [`frontend/src/lib/edi/upload-helper.ts`](../frontend/src/lib/edi/upload-helper.ts) — verwerkt `.inh`-bestand: sanity-check, parse, dedup op SHA-256, debiteur-match op GLN, insert, `create_edi_order` RPC.
  - [`frontend/src/lib/edi/transus-xml.ts`](../frontend/src/lib/edi/transus-xml.ts) — pure TransusXML-builder met `buildOrderbevTransusXml` + `buildOrderResponseNumber`. Format reverse-engineered uit echt BDSK-bestand `orderbev-uit-bdsk-168911805.xml`.
  - [`frontend/src/lib/edi/download-orderbev-xml.ts`](../frontend/src/lib/edi/download-orderbev-xml.ts) — bouwt XML on-demand uit DB-state (order + regels + producten.ean_code) en triggert download.
  - [`frontend/src/components/edi/upload-bericht-dialog.tsx`](../frontend/src/components/edi/upload-bericht-dialog.tsx) — modal met file-input, dedup-flag en preview-stap.
- **Database (migratie 161):**
  - `edi_handelspartner_config.orderbev_format` enum (`transus_xml` / `fixed_width`, default `transus_xml`).
  - `edi_berichten.order_response_seq` integer voor `<OrderResponseNumber>`-bouw (4-digit zero-padded suffix conform BDSK-voorbeeld: `26554360` + `0001` = `265543600001`).
  - `edi_berichten.transus_test_*` velden voor handmatige Transus-validatie-status (fase 4).
  - `ruim_edi_demo_data()` uitgebreid met `UPLOAD-`-prefix.
- **Parser-tolerantie:** `parseKarpiOrder` accepteert nu lengte-varianten van ±2 bytes per regel (rechts-padding met spaces). Echte BDSK 8MRE0 fixture had header 462 bytes ipv 463 — Transus levert soms zonder trailing space.
- **Tests:** 19 unit-tests groen in `src/lib/edi/`. Inclusief byte-vergelijking van TransusXML-builder tegen `orderbev-uit-bdsk-168911805.xml` en parser-test op `rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh`.

---

## 2026-04-30 — EDI/Transus pre-cutover dataverzamelplan

Nieuw document [`docs/transus/pre-cutover-data-stappenplan.md`](transus/pre-cutover-data-stappenplan.md) toegevoegd met een praktisch stappenplan voor de EDI-cutover: welke Transus-specificaties, voorbeeldberichten, GLN-/artikelmappings, API-testgegevens en operationele afspraken nog verzameld moeten worden, plus wat er technisch moet gebeuren zodra die data compleet is.

- **Waarom:** De huidige demo-rondreis bewijst vooral de interne RugFlow-flow, maar nog niet dat echte Transus input/output voor orderbevestiging en factuur door partners wordt geaccepteerd. Het plan maakt expliciet waar de go/no-go voor cutover op gebaseerd moet zijn.
- **Belangrijkste focus:** orderbevestiging eerst hard valideren via Transus Online `Bekijken en testen`; pas daarna M10100/M10110/M10300 productieflow activeren.

---

## 2026-04-29 — Orderregel claim-uitsplitsing als geneste sub-rijen

Op order-detail toont elke stuks-orderregel nu de volledige bron-uitsplitsing als visueel geneste sub-rijen onder de hoofdregel — gericht op de verzamelaar in het magazijn die moet zien dat een deel van een uitwisselbaar artikel komt en omgestickerd moet worden.

- **Wat er per regel staat:** vier mogelijke sub-rijen in vaste leverbaarheid-volgorde — eigen voorraad → omsticker → IO → wacht op nieuwe inkoop. Sub-aantallen tellen op tot `te_leveren` (synthetische "wacht"-rij vult het tekort in).
- **Visuele stijl:** neutraal grijs voor eigen voorraad + IO; amber voor omsticker (actie vereist); rose voor wacht (probleem). Sub-aantallen staan onder de "Te leveren"-kolom; bron-info colSpant Artikel + Omschrijving (Patroon II — aantallen blijven uitgelijnd).
- **Omsticker-regel** toont het bron-artikelnr (klikbaar), omschrijving van het uitwisselbare product, locatie als bekend, en een expliciete "→ stickeren naar {orderregel.artikelnr}"-noot.
- **Scope:** alleen stuks-orders met `te_leveren > 0` en `is_maatwerk=false`. Maatwerk-regels behouden hun bestaande paarse maatwerk-info-rij; m-rollen-orders en volledig verzonden regels blijven zonder sub-rijen.
- **Verwijderd:** de klikbare popover (`RegelClaimDetail`) op de levertijd-badge en de `via INK-...`-hint daaronder — dezelfde info staat nu uitgeklapt zonder klik. `LevertijdBadge` blijft op de hoofdregel als snelle status-glance.
- **Niet op factuur:** de uitsplitsing is puur intern/operationeel. Conform business-rule mig 154 blijven factuur en order-regel-weergave 1× origineel artikel.
- **Data:** nieuwe query [`fetchClaimsVoorOrder`](../frontend/src/lib/supabase/queries/reserveringen.ts) — één call voor alle claims van een order + één gebatchte product-lookup voor `fysiek_artikelnr`-omschrijving en -locatie. Hook `useClaimsVoorOrder` parallel aan `useLevertijdVoorOrder`.

---

## 2026-04-29 — EDI/Transus-koppeling: fundament voor inkomend verkeer

Eerste fase van de migratie van Windows Connect (op MITS-CA-01-009) naar de Transus SOAP API. Karpi heeft 39 EDI-handelspartners (~9.000 berichten/12 maanden, top-5 = 84% volume — BDSK 44%, SB-Möbel BOSS 18%, Hornbach NL, Hammer, Krieger). Plan: [`docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md`](superpowers/plans/2026-04-29-edi-transus-koppeling.md).

- **Bericht-formaat: fixed-width "Custom ERP" (Basta-compatibel).** Drie productie-voorbeelden van 2026-04-29 geanalyseerd ([`docs/transus/voorbeelden/`](transus/voorbeelden/)). Transus-Online label bevestigt: gegevensbron-type "Fixed length", ID 17653, versie 10. Kolomposities reverse-engineered uit Ostermann (rijke veldenset, 23 regels) + BDSK (schrale veldenset, 1 regel). Header = 463 bytes, article = 281 bytes. EDIFACT-passthrough naar partners blijft werk van Transus.
- **Datamodel:** [`edi_handelspartner_config`](../supabase/migrations/156_edi_handelspartner_config.sql) (per debiteur de 4 berichttype-toggles + transus_actief + test_modus); [`edi_berichten`](../supabase/migrations/157_edi_berichten.sql) (centrale audit-/queue-tabel met enum `edi_bericht_status`); GLN-velden + `bes_*`-snapshots op `orders` voor de 4-staps partij-keten (BY/IV/DP/SN); `app_config.bedrijfsgegevens.gln_eigen=8715954999998`.
- **RPCs:** `log_edi_inkomend` (idempotent op transactie_id), `markeer_edi_ack`, `enqueue_edi_uitgaand` (idempotent op berichttype+bron), `claim_volgende_uitgaand` (FOR UPDATE SKIP LOCKED), `markeer_edi_verstuurd`, `markeer_edi_fout` (retry-loop, max 3).
- **Edge functions:** [`_shared/transus-soap.ts`](../supabase/functions/_shared/transus-soap.ts) (M10100/M10110/M10300 SOAP-client, base64+CP-1252 handling); [`_shared/transus-formats/karpi-fixed-width.ts`](../supabase/functions/_shared/transus-formats/karpi-fixed-width.ts) (parser voor Order-bericht — 100% match tegen 2 voorbeelden in test); [`transus-poll`](../supabase/functions/transus-poll/index.ts) (cron-driven inbox-leeghaler in **read-only modus**: parseert + logt + ackt zonder order-creatie).
- **Frontend:** nieuwe sidebar-sectie "EDI" met `/edi/berichten`-overzicht (in/uit toggle, status- en type-filters, polling 30s) en `/edi/berichten/:id` detailpagina (geparseerde JSON + ruwe payload + retry-info + gerelateerde order/factuur).
- **Buiten V1-fase 1:** order-creatie via `create_edi_order` RPC (komt in fase 2 zodra parser-validatie via Transus' Testen-tab klopt); uitgaande triggers voor orderbev/factuur/verzending; cutover van WC naar API. Vereist nog: `TRANSUS_CLIENT_ID` + `TRANSUS_CLIENT_KEY` als Supabase secrets, test-handelspartner van Transus, en Maureen-akkoord voor de Custom ERP-config-overstap.
- **Cutover-constraint** (uit Transus' antwoord): Windows Connect en de API kunnen niet parallel draaien (beide bevestigen automatisch). Cutover is dus big-bang voor alle 39 partners. Pilot-validatie loopt via Transus' test-handelspartner.
- **Migraties:** [156](../supabase/migrations/156_edi_handelspartner_config.sql), [157](../supabase/migrations/157_edi_berichten.sql).

---

## 2026-04-29 — Inkoop-reserveringen V1: bugfixes + afleverdatum-sync + uitwisselbaar-hint

Drie issues uit de eerste live-test van ORD-2026-2004:

- **Migratie 153** — `herwaardeer_order_status` synct nu ook `orders.afleverdatum` naar de laatste IO-claim-leverdatum (verwacht_datum + buffer). Schuift alleen vooruit, nooit terug. Voorheen gaf ORD-2026-2004 afleverdatum 04-05-2026 + levertijd 2026-W27 — inconsistent. Helper `bereken_late_claim_afleverdatum(order_id)` + `sync_order_afleverdatum_met_claims(order_id)`. Backfill draait éénmalig over alle open orders met IO-claims.
- **Bug fix** [`fetchClaimsVoorProduct`](../frontend/src/lib/supabase/queries/producten.ts) — PostgREST `.eq()` op een nested join-kolom (`order_regels.artikelnr`) filterde niet. Herschreven naar twee-stap: eerst orderregel-IDs van het artikel ophalen (incl. `fysiek_artikelnr` voor omstickeren), dan claims op die IDs. Product-detail toont nu correct de "Op voorraad gereserveerd" + "Wacht op inkoop" secties voor het bekeken artikel.
- **UI-suggestie uitwisselbaar bij tekort** — nieuwe component [`UitwisselbaarTekortHint`](../frontend/src/components/orders/uitwisselbaar-tekort-hint.tsx) verschijnt inline onder een orderregel met `te_leveren > vrije_voorraad` als er uitwisselbare producten met voorraad zijn. Klik = `omstickeren` aanzetten (commerciële keuze van de gebruiker, geen DB-allocatie). Allocator blijft simpel: exact-artikelnr-matching.

---

## 2026-04-29 — Inkoop-reserveringen V1 (vaste maten)

Reserveringssysteem uitgebreid met harde koppeling naar inkooporderregels voor vaste maten — order-aanmaak alloceert automatisch over voorraad + openstaande inkoop, met klantkeuze "deelleveren / in 1×" en berekende verwachte leverweek per orderregel. Maatwerk krijgt alleen een levertijd-indicator (V1).

- **Datamodel:** nieuwe tabel [`order_reserveringen`](../supabase/migrations/144_order_reserveringen_basis.sql) (`bron='voorraad' | 'inkooporder_regel'`); kolom `orders.lever_modus` (`deelleveringen | in_een_keer`); enum-waarde `Wacht op inkoop`. Buffer-keys `inkoop_buffer_weken_vast=1` / `inkoop_buffer_weken_maatwerk=2` in `app_config.order_config`.
- **Allocatie-seam:** [`herallocateer_orderregel(p_order_regel_id)`](../supabase/migrations/145_order_reserveringen_rpcs.sql) — idempotent: release alle actieve claims + alloceer voorraad-eerst, dan oudste IO (`verwacht_datum ASC`). Triggers (mig 146) op `order_regels` mutatie + `orders` status + `inkooporders` `Geannuleerd` schakelen automatisch in. Claim-volgorde-prio: wie eerst claimt, wordt eerst beleverd.
- **Vrije voorraad:** `vrije_voorraad = voorraad − gereserveerd − backorder` (geen `+ besteld_inkoop` meer); `gereserveerd` is voortaan SUM van actieve `bron='voorraad'`-claims (mig 149). Toekomstige inkoop blijft zichtbaar via `besteld_inkoop` en `order_reserveringen` maar telt niet meer mee in "vandaag-leverbaar".
- **Ontvangst:** [`boek_voorraad_ontvangst`](../supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql) consumeert IO-claims in claim-volgorde en verschuift naar voorraad-claims (mig 148).
- **Views:** `order_regel_levertijd` (status + verwachte_leverweek per regel) + `inkooporder_regel_claim_zicht` (geclaimd/vrij per IO-regel) — mig 150.
- **RPC's bijgewerkt (mig 152):** `create_order_with_lines` + `update_order_with_lines` lezen `lever_modus` uit JSONB-payload zodat de `LeverModusDialog`-keuze persisteert.
- **Frontend:** levertijd-badge per orderregel (groen/amber/rose/violet) met claim-popover (`RegelClaimDetail`); `LeverModusDialog` opent bij opslaan als ≥1 regel tekort heeft (default uit `debiteuren.deelleveringen_toegestaan`); `IORegelClaimsPopover` op IO-detail; "Op voorraad gereserveerd" + "Wacht op inkoop" secties op product-detail; maatwerk-levertijdhint op `op-maat-selector` (eerstvolgende inkoopweek + 2 wk).
- **Architectuur:** gedeelde [`isoWeek()`-helper](../frontend/src/lib/utils/iso-week.ts) — bron-van-waarheid voor week-uit-datum berekeningen in de UI, parallel aan SQL-side `iso_week_plus()`.
- **Migraties:** [144](../supabase/migrations/144_order_reserveringen_basis.sql), [145](../supabase/migrations/145_order_reserveringen_rpcs.sql), [146](../supabase/migrations/146_order_reserveringen_triggers.sql), [147](../supabase/migrations/147_inkoop_status_release_trigger.sql), [148](../supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql), [149](../supabase/migrations/149_vrije_voorraad_semantiek.sql), [150](../supabase/migrations/150_order_reserveringen_views.sql), [151](../supabase/migrations/151_backfill_order_reserveringen.sql), [152](../supabase/migrations/152_order_rpcs_lever_modus.sql).
- **V2-backlog:** maatwerk-claim op IO-rol, handmatige IO-keuze (override), spoed-prio (claim-stelen), klantnotificatie bij IO-vertraging, claim voor `eenheid='m'`-rollen.

---

## 2026-04-29 — Snijden: SnijVolgorde als deep module + operator-vriendelijke mes-instructies

### 2026-04-29 — Rol-uitvoer modal: rij = breedte-mes-instelling, geen y-band-clustering
- **Wat:** De rol-uitvoer modal toonde elke shelf met absolute lengte-mes-positie ("Rij 1 · Lengte-mes op 866 cm") en clusterde pieces met aangrenzende y-banden ten onrechte in één rij. Nieuw: **één Rij = één breedte-mes-instelling**. Pieces gestapeld langs de rollengte met verschillende breedtes worden nu aparte Rijen; consecutive Rijen met dezelfde primary breedte-mes-positie krijgen een `(blijft staan)`-badge ("Mes laten staan op 325" — operator-feedback van 24-04). Ronde stukken tonen "snij vierkant 325×325 → 320×320 rond met de hand" met de marge correct opgeteld. Lengte-mes is nu incrementeel ("lengte 275") i.p.v. absoluut.
- **Waarom:** Operator-feedback van de snijder (24-04, 3 screenshots IC2901TA21C/VERR130 C/I26080LO13C/MARI13): de huidige modal toonde foute mes-instellingen — soms één Rij voor 3 pieces met verschillende breedtes, ronde stukken zonder de +5cm vierkant-instructie, en absolute lengte-mes-waarden waar incrementele duidelijker zijn. Het deep-module-refactor extraheert ~250 regels shelf-grouping + knife-derivation uit `rol-uitvoer-modal.tsx` (842→~600 regels) naar [`frontend/src/lib/snij-volgorde/`](frontend/src/lib/snij-volgorde/) als pure functie — testbaar zonder React-mount, herbruikbaar voor toekomstige print/sticker views, en de rij-definitie matcht het mentale model van de operator.
- **Architectuur:** [`buildSnijVolgorde(input) → SnijVolgorde`](frontend/src/lib/snij-volgorde/derive.ts) is een pure functie die `Placement[]` (uit `snijplanning_overzicht`) + reststukken/aangebroken/afval (uit [compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts)) transformeert naar geordende `Rij[]` met `KnifeOperation`-rijen. Per `KnifeOperation` zijn `snij_maat` (wat het mes maakt, incl. marge) en `bestelde_maat` (klant-orientatie) gescheiden, plus een `handeling`-enum (`geen|orientatie_swap|rond_uitsnijden|ovaal_uitsnijden|zo_marge_extra`) die de UI vertaalt naar de juiste hand-bewerking-tekst.
- **Migratie 143:** [`supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql`](supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql) breidt `snijplanning_overzicht` uit met `marge_cm` (single-source uit `stuk_snij_marge_cm()` migratie 126) en `geroteerd` (was niet via view exposed). **Status:** initiële migratie-poging gaf `42P16: cannot drop columns from view` omdat de live view extra kolommen heeft die niet in de repo staan (gemaakt via SQL editor). Wachten op Miguel's kolom-output van `information_schema.columns` voor strikte superset.
- **Tests:** 19 nieuwe unit tests in [derive.test.ts](frontend/src/lib/snij-volgorde/derive.test.ts) met echte LORA 13-fixture (uit DB-query 2026-04-29), synthetische multi-lane (VERR130 C-stijl), geroteerd rechthoek, ZO-marge, en reststuk-markers.
- **Files:** [frontend/src/lib/snij-volgorde/types.ts](frontend/src/lib/snij-volgorde/types.ts), [frontend/src/lib/snij-volgorde/derive.ts](frontend/src/lib/snij-volgorde/derive.ts), [frontend/src/lib/snij-volgorde/derive.test.ts](frontend/src/lib/snij-volgorde/derive.test.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql](supabase/migrations/143_snijplanning_overzicht_marge_geroteerd.sql).

## 2026-04-29 — Uitwisselbaarheid: canonieke seam (fase 1 — functie + diff-check)

### 2026-04-29 — Fase 2 (deel 1): snijplanning callers omzetten naar `uitwisselbare_paren()`
- **Wat:** Migratie [142_tekort_analyse_via_uitwisselbare_paren.sql](supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql) herschrijft `snijplanning_tekort_analyse()`: de drie parallelle CTE's (Map1 / collectie / self) worden vervangen door één `LATERAL JOIN uitwisselbare_paren(g.kwaliteit_code, g.kleur_code)`. Daarnaast: TypeScript-helpers `fetchUitwisselbarePairs` + `fetchUitwisselbareCodes` zijn samengevoegd tot één `fetchUitwisselbareParen()` die de RPC aanroept; `fetchBeschikbareRollen` + `fetchBezettePlaatsingen` accepteren nu een `KwaliteitKleurPair[]`-input. Edge functions [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) en [optimaliseer-snijplan](supabase/functions/optimaliseer-snijplan/index.ts) zijn ontdaan van hun Map1→collectie fallback-cascade — één RPC-call doet alles.
- **Waarom:** De edge function en de UI tekort-analyse gebruikten verschillende fallback-volgordes en konden daardoor verschillende uitwissel-sets opleveren voor hetzelfde input-paar. Met de canonieke seam zien beide gegarandeerd dezelfde set. De code is bovendien fors korter (geen handgeschreven OR-clauses meer in de edge, geen drie-CTE-cascade in SQL).
- **Status van de 4 conflict-paren** uit de diff-check: DREA ↔ PLUS (basis PLUS11/PLUS12), waar Map1 ze als aliassen markeert maar de collecties "cloud" (id 36) en "PLUSH" (id 30) ze als verschillende lijnen behandelen. Beslissing: collecties wint; deze 4 Map1-rijen verdwijnen vanzelf wanneer Map1 in fase 3 gedropt wordt. Mocht het toch dezelfde lijn zijn, dan kan handmatig `UPDATE kwaliteiten SET collectie_id = 36 WHERE collectie_id = 30` uitgevoerd worden voordat fase 3 start.
- **Volgende stappen** (fase 2 — deel 2): `kleuren_voor_kwaliteit()` SQL refactoren; `op-maat.ts` `fetchMaatwerkArtikelNr` + `fetchStandaardBandKleur` ad-hoc cascades vervangen; heroverwegen of `uitwisselbare_partners` + `rollen_uitwissel_voorraad` nog nodig zijn naast de RPC. **Fase 3:** `kwaliteit_kleur_uitwisselgroepen` + view `kwaliteit_kleur_uitwisselbaar` + `import_uitwisselgroepen.py` droppen.
- **Files:** [supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql](supabase/migrations/142_tekort_analyse_via_uitwisselbare_paren.sql), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts).

### 2026-04-29 — Map1 → collectie-gaps data-driven dichten (alle groepen)
- **Wat:** Migratie [141_uitwissel_collectie_gaps_data_driven.sql](supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql) loopt over ALLE Map1-groepen `(basis_code, variant_nr)` en past de structurele gaps aan: groepen waarvan geen lid een collectie heeft krijgen een nieuwe collectie (naam = basis_code, groep_code = `m1_<basis>_v<n>`); groepen waarvan één lid wel een collectie heeft krijgen de andere leden in diezelfde collectie. Genuine conflicts (leden in verschillende collecties — 4 paren in de diff-check) worden geskipt met `RAISE NOTICE` en blijven zichtbaar in `uitwisselbaarheid_map1_diff` voor handmatige beslissing.
- **Waarom:** Migratie 139 dekte slechts 3 hand-gepickte clusters; de echte diff was 154 rijen verspreid over veel meer Map1-groepen. Een data-driven aanpak is robuuster en idempotent.
- **Files:** [supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql](supabase/migrations/141_uitwissel_collectie_gaps_data_driven.sql).

### 2026-04-29 — `uitwisselbare_paren()` v2: bron-check verwijderen + genormaliseerde output
- **Wat:** Migratie [140_uitwisselbare_paren_zonder_bron_check.sql](supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql) herschrijft de canonieke functie. Twee aanpassingen: (1) de check "(target_kw, target_kl) moet bestaan in producten ∪ rollen ∪ maatwerk_m2_prijzen" is verwijderd — pure aliassen zonder eigen voorraad/product (zoals SOPI/SOPV) werden onterecht overgeslagen; (2) `target_kleur_code` in de output is nu altijd genormaliseerd (".0"-suffix gestript), callers normaliseren hun join-side.
- **Waarom:** De v1 uit migratie 138 koppelde de aliassing-relatie aan voorraad-bestaan. Maar zoals het domein werkt: voorraad ligt vaak alleen onder de "primaire" naam (CISC of VELV), pas bij output (sticker na snijden, of stickerwissel bij vaste maten) wordt een alias-naam toegekend. SOPI is een valide alias voor CISC ook als er nooit een SOPI-rij in producten staat. De relatie is *administratief*, niet *materieel*. Diff-check `uitwisselbaarheid_map1_diff` gaf na migratie 139 dan ook 154 rijen i.p.v. de verwachte 0; na 140 zou dat 0 moeten zijn.
- **Files:** [supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql](supabase/migrations/140_uitwisselbare_paren_zonder_bron_check.sql).

### 2026-04-29 — Map1 → collectie-gaps dichten (3 clusters)
- **Wat:** Migratie [139_uitwissel_collectie_gaps_dichten.sql](supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql) repareert de 49 rijen die de diff-check uit migratie 138 retourneerde — allemaal categorie "input/target zonder collectie_id". Drie clusters waar Map1 wél een aliassing-relatie bevatte maar `kwaliteiten.collectie_id` niet ingevuld was: SOPI+SOPV (gekoppeld aan bestaande CISC/VELV-collectie), ANNA+BREE (nieuwe collectie `m1anna`), BERM+EDGB (nieuwe collectie `m1berm`). Idempotent (`ON CONFLICT DO NOTHING` + `IS NULL`-guards). Verificatie: na toepassing moet `SELECT COUNT(*) FROM uitwisselbaarheid_map1_diff` = 0 geven.
- **Waarom:** Map1 dekte deze paren wel, de collectie-regel niet. Voordat callers omgezet kunnen worden naar `uitwisselbare_paren()` moest de collectie-tabel deze paren ook bevatten — anders zouden ze als "geen partners" worden gezien zodra Map1 wegvalt. Naam-keuze "m1anna"/"m1berm" is een placeholder; hernoemen kan later via UPDATE op `collecties.naam`.
- **Files:** [supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql](supabase/migrations/139_uitwissel_collectie_gaps_dichten.sql).

### 2026-04-29 — `uitwisselbare_paren()` als bron-van-waarheid voor uitwissel-relaties
- **Wat:** Migratie [138_uitwisselbare_paren_canoniek.sql](supabase/migrations/138_uitwisselbare_paren_canoniek.sql) introduceert SQL-functie `uitwisselbare_paren(p_kwaliteit_code, p_kleur_code)` die alle aliassen voor een (kwaliteit, kleur)-paar teruggeeft. Resolver: zelfde `kwaliteiten.collectie_id` én genormaliseerde kleur-code matcht (via bestaande helper `normaliseer_kleur_code()`). Bron: producten ∪ rollen ∪ maatwerk_m2_prijzen — een paar wordt herkend zodra het ergens in het systeem bestaat. Self-row altijd gegarandeerd. Plus: diagnostische view `uitwisselbaarheid_map1_diff` die laat zien welke Map1-paren nog NIET door de nieuwe regel afgedekt worden, met een `reden`-kolom per onbedekt paar.
- **Waarom:** De edge functie voor snijplanning had inconsistent gedrag bij uitwisselbare kwaliteiten omdat ZES callers zelfstandig de uitwissel-logica reproduceerden — soms op `kwaliteit_kleur_uitwisselgroepen` (Map1), soms op `kwaliteiten.collectie_id`, soms op een hybride fallback-cascade, met verschillende uitkomsten voor dezelfde input. Daardoor zag bv. order-aanmaak géén equivalent-voorraad waar snijplanning die wél vond. De UI Producten → "Uitwisselbaar"-tab gebruikte al de collectie+kleur-regel (56 groepen, 170 leden, kleuren met hetzelfde nummer auto-gekoppeld) — dat is nu de canonieke regel die alle backend-callers gaan delen. Domein-rationale: kwaliteit-codes zijn aliassen voor één fysieke partij (verschillende namen voor verschillende afnemers), zie nieuwe entry "Aliassing-lagen" in [data-woordenboek.md](docs/data-woordenboek.md).
- **Volgende stappen** (na verificatie dat `SELECT * FROM uitwisselbaarheid_map1_diff` leeg is, eventueel via collectie-membership uitbreiden voor onbedekt paren): herschrijf `snijplanning_tekort_analyse()` + `kleuren_voor_kwaliteit()`, vervang `_shared/db-helpers.ts` `fetchUitwisselbarePairs`/`fetchUitwisselbareCodes` door één RPC-call, refactor `op-maat.ts` `fetchMaatwerkArtikelNr` + `fetchStandaardBandKleur`, drop `kwaliteit_kleur_uitwisselgroepen` + view `kwaliteit_kleur_uitwisselbaar` + import-script `import_uitwisselgroepen.py`.
- **Files:** [supabase/migrations/138_uitwisselbare_paren_canoniek.sql](supabase/migrations/138_uitwisselbare_paren_canoniek.sql), [docs/data-woordenboek.md](docs/data-woordenboek.md), [docs/database-schema.md](docs/database-schema.md).

## 2026-04-24 — Inkoop-zicht op rollen-overview + product-detail

### 2026-04-24 — Tag "besteld m²" per kwaliteit/kleur + eerstvolgende leverweek
- **Wat:** Nieuwe RPC [`besteld_per_kwaliteit_kleur()`](supabase/migrations/137_besteld_per_kwaliteit_kleur.sql) aggregeert openstaande inkooporder-regels per (kwaliteit, kleur): totaal `te_leveren_m`, omgerekend naar m² via `kwaliteiten.standaard_breedte_cm`, aantal orders, eerstvolgende `leverweek` + `verwacht_datum`, plus het deel dat in díe eerstvolgende levering valt. Hergebruikt de bestaande view `openstaande_inkooporder_regels` (migratie 127). `fetchRollenGegroepeerd()` mergt deze info op elke groep (veld `inkoop`) en maakt ook lege groepen aan voor combinaties die alléén besteld staan — zodat "LAMI 15 — 300 m² besteld, wk 18/2026" toch in de overview verschijnt.
- **Waarom:** Zonder dit was "hoeveel komt er nog binnen?" alleen zichtbaar in het inkoopmodule-overzicht, niet op het moment dat je naar een voorraad-groep kijkt. Operators/inkopers zagen vaak "Geen voorraad" terwijl er volgende week al een rol zou binnenkomen. De eerstvolgende leverweek in de tag maakt directe prioritering mogelijk ("kan ik wachten of moet ik nu orderen?").
- **UI:** [rollen-groep-row.tsx](frontend/src/components/rollen/rollen-groep-row.tsx) — nieuwe `BesteldChip` naast de bestaande status-badges/partner-chips, met `Truck`-icoon, m²-totaal en "wk NN/YYYY"-label. Bij hover tooltip met orders-count + split "waarvan X m² in eerste levering". Lege groepen (alleen inkoop, geen voorraad) vervangen de "Geen voorraad"-tag door de inkoop-chip.
- **Files:** [supabase/migrations/137_besteld_per_kwaliteit_kleur.sql](supabase/migrations/137_besteld_per_kwaliteit_kleur.sql), [frontend/src/lib/supabase/queries/rollen.ts](frontend/src/lib/supabase/queries/rollen.ts), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [frontend/src/components/rollen/rollen-groep-row.tsx](frontend/src/components/rollen/rollen-groep-row.tsx).

### 2026-04-24 — Product-detail: sectie "Openstaande inkooporders"
- **Wat:** Product-detailpagina krijgt een nieuwe tabel onder de voorraad-block met álle openstaande inkooporder-regels voor het artikel: inkooporder-nr (link naar detail), leverancier, status, verwachte leverweek, besteld/geleverd/te leveren meters. Gesorteerd op `verwacht_datum ASC` zodat de eerstvolgende levering bovenaan staat. Nieuwe query `fetchOpenstaandeInkoopregelsVoorArtikel()` + hook `useOpenstaandeInkoopVoorArtikel()` — leest rechtstreeks uit de bestaande view `openstaande_inkooporder_regels`.
- **Waarom:** Het veld "Besteld (ink)" in de voorraad-block toonde alleen een totaal zonder context. Je moest naar het inkoopmodule om te zien wanneer/van wie het kwam. Nu is dat één blik op de productpagina.
- **Files:** [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/pages/producten/product-detail.tsx](frontend/src/pages/producten/product-detail.tsx).

## 2026-04-24 — Fix: `boek_ontvangst` werkelijke voorraad_mutaties-kolommen
- **Wat:** Migratie [136_boek_ontvangst_voorraad_mutaties_schema_fix.sql](supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql) herschrijft de INSERT in `voorraad_mutaties` binnen `boek_ontvangst` naar de werkelijke kolomnamen: `lengte_cm`/`breedte_cm`/`notitie`/`aangemaakt_door`/`referentie_id`/`referentie_type` + `type='inkoop'`. Eerdere versies (migraties 127/133/135) gebruikten verzonnen namen (`lengte_voor_cm`, `lengte_na_cm`, `reden`, `medewerker`, type=`'ontvangst'`) uit outdated docs, wat leidde tot runtime-error `column "lengte_voor_cm" of relation "voorraad_mutaties" does not exist` zodra een operator ontvangst probeerde te boeken.
- **Waarom:** De echte tabel-definitie komt uit commit `ece9ecd` (productiemodule-foundation) en is nooit gewijzigd. De docs in [database-schema.md](docs/database-schema.md) beschreven een verzonnen schema — nu gesynchroniseerd met de werkelijke DB-structuur.
- **Files:** [supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql](supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql), [docs/database-schema.md](docs/database-schema.md).

## 2026-04-24 — Inkoop: auto-genereer rolnummers bij ontvangst (R-YYYY-NNNN)

### 2026-04-24 — `boek_ontvangst` genereert rolnummer automatisch
- **Wat:** Migratie [135_boek_ontvangst_auto_rolnummer.sql](supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql) maakt sequence `r_2026_seq` en update `boek_ontvangst`: als het `rolnummer`-veld in de JSONB input leeg/null is, genereert hij via `volgend_nummer('R')` een nieuw nummer in de ERP-brede conventie (`R-2026-0001`, `R-2026-0002`, …). Behoudt de m²-fix uit migratie 133. Bij (zeer onwaarschijnlijke) collision met legacy numerieke/S-prefix rolnummers retry't de RPC tot een vrij nummer.
- **Waarom:** Operator hoefde geen zelfbedacht rolnummer meer te typen in de ontvangst-dialog (foutgevoelig, risico op duplicaten/collisions). De conventie `R-YYYY-NNNN` is consistent met `ORD-YYYY-`, `INK-YYYY-`, `SNIJ-YYYY-` en onmiddellijk herkenbaar als "nieuwe-systeem-rol" t.o.v. legacy (puur numeriek of S-prefix).
- **UI:** [ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx) — rolnummer-input is niet meer verplicht (placeholder "leeg = auto R-YYYY-NNNN"). Na succes toont de dialog een bevestigings-view met de toegekende rolnummers zodat de operator ze kan noteren/printen voor de fysieke rollen.
- **Bonus-fix:** `useBoekOntvangst` invalideert nu ook `['inkooporder-detail']` — voorheen bleef "Te leveren" op de detail-pagina hangen op de oude waarde direct na ontvangst.
- **Files:** [supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql](supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql), [frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts).

## 2026-04-24 — Snijplanning: cross-kwaliteit fix + tekort-analyse UI + packing lookahead

### 2026-04-24 — Packing lookahead: minimaliseer aantal aangesneden rollen
- **Wat:** `packAcrossRolls` in [guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) draait nu **twee greedy passes** met verschillende rol-sortering en kiest de globaal beste uitkomst. De default sort (reststuk-eerst, daarbinnen kleinste) behoudt reststuk-opmaak-gedrag; de nieuwe `sortRollsLargestFirst` probeert binnen dezelfde priority-tier grootste rol eerst te gebruiken. `compareResults` pikt de uitkomst met minste niet-geplaatst → minste rollen → minste m²-gebruik → laagste afval.
- **Waarom:** Real-world case MARI 13 (2026-04-24): 5 stukken met 3 beschikbare rollen (1300, 1500, 350). Oude packer kiest kleinste rol eerst → 3 rollen aangebroken. Operator bevestigde dat alle 5 op de 1500-rol passen met rotaties (Y-gebruik ~1440 cm). Elk extra aangebroken rol = schaar-omstelling + meer reststuk-fragmenten = verloren tijd.
- **Impact:** Geen API-wijziging; edge functions (`auto-plan-groep`, `optimaliseer-snijplan`) werken onveranderd. Regressietest toegevoegd in [guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts): `LOOKAHEAD: MARI13 — bundelt op 1 grote rol` + `LOOKAHEAD: reststuk-voorkeur blijft gerespecteerd`. Runtime-kosten: 2× packing-werk per groep — acceptabel want groepen zijn klein (≤ tientallen stukken).
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts).

## 2026-04-24 — Snijplanning: cross-kwaliteit release-bug + tekort-analyse UI-mismatch

### 2026-04-24 — Fix: `release_gepland_stukken` respecteert cross-kwaliteit plaatsingen
- **Wat:** Migratie [133_release_gepland_op_bestel_kwaliteit.sql](supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql) herschrijft `release_gepland_stukken(p_kwaliteit, p_kleur)` zodat hij filtert op `order_regels.maatwerk_kwaliteit_code / _kleur_code` i.p.v. op `rollen.kwaliteit_code / _kleur_code`. De oude versie (migratie 073) gaf álle Gepland-snijplannen op een LUXR-rol vrij wanneer `auto-plan-groep(LUXR, 17)` draaide — dus ook de VERR 17-stukken die via uitwisselbaarheid correct op LUXR-rollen geplaatst stonden. Die verweesden daarna (`rol_id = NULL`) terwijl hun snijvoorstel op `goedgekeurd` bleef staan.
- **Waarom:** Root cause-analyse (systematic-debugging skill, zie conversatie 2026-04-24) wees uit dat het packing-algoritme wél correcte kandidaten vond en `keur_snijvoorstel_goed` wél juist koppelde, maar dat de eerstvolgende auto-plan-cyclus voor de ROL-kwaliteit de cross-kwaliteit plaatsingen kapot maakte. Symptoom: screenshots waar LUXR-rollen VERR-stukken toonden in het goedgekeurde voorstel, maar de huidige `snijplannen`-rij `rol_id = NULL` had. Exacte matches (LUXR-stuk op LUXR-rol) bleven heel, omdat die alleen geraakt werden wanneer de eigen kwaliteit-groep herplande.
- **Impact:** Cross-kwaliteit plaatsingen blijven voortaan intact. Bestaande verweesde snijplannen (`rol_id=NULL, status=Gepland/Wacht`) worden automatisch opgepakt zodra `auto-plan-groep` opnieuw voor hún eigen groep draait. Voor een eenmalige sweep: `node scripts/herplan-alle-groepen.mjs`.
- **Regressietest:** [scripts/test-release-cross-kwaliteit.sql](scripts/test-release-cross-kwaliteit.sql) — dummy VERR-op-LUXR plaatsing + beide release-richtingen, alles in `BEGIN; … ROLLBACK;` zodat er geen data blijft hangen.
- **Files:** [supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql](supabase/migrations/133_release_gepland_op_bestel_kwaliteit.sql), [scripts/test-release-cross-kwaliteit.sql](scripts/test-release-cross-kwaliteit.sql).

### 2026-04-24 — Fix: `snijplanning_tekort_analyse()` synchroon met edge (Map1 + placeholders)
- **Wat:** Migratie [134_tekort_analyse_map1_en_placeholders.sql](supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql) herschrijft `snijplanning_tekort_analyse()` zodat hij (1) primair de fijnmazige Map1 (`kwaliteit_kleur_uitwisselbaar` view) raadpleegt en pas op `kwaliteiten.collectie_id` terugvalt als Map1 leeg is — identiek aan `auto-plan-groep` edge function, en (2) placeholder-rollen (`lengte_cm = 0 OR breedte_cm = 0`) uitsluit uit zowel de telling als de `max_lange/max_korte`-bepaling.
- **Waarom:** De UI-diagnose verschilde van de realiteit die de edge ziet. Voorbeelden uit productie: `VELV 15` toonde collectie-codes `CAST,CISC,SPRI,VELV` terwijl Map1 ook `SOPI/SOPV` bevat; `OASI 51` zei "geen collectie" terwijl Map1 `WOTO 51` als partner heeft. Placeholders (0×0 stub-rollen voor inkoop-signalering uit migratie 112) leidden tot de misleidende melding `Rol te klein max 0×0 cm` i.p.v. "geen bruikbare voorraad".
- **Impact:** Return-signatuur ongewijzigd — `groep-accordion.tsx` en `snijplanning.ts`-query blijven werken zonder frontend-wijziging. `heeft_collectie` is nu TRUE zodra Map1 óf collectie uitwissel-opties biedt (kolomnaam is legacy; semantiek = "heeft uitwissel-partners").
- **Files:** [supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql](supabase/migrations/134_tekort_analyse_map1_en_placeholders.sql).

## 2026-04-24 — Inkoopmodule V1: leveranciers + inkooporders + ontvangst-flow

### 2026-04-24 — Team snijtafel uitgesloten + eenheid (m/stuks) per regel
- **Wat:** Inkooporder_regels krijgt kolom `eenheid` CHECK `('m','stuks')` — afgeleid uit `producten.product_type` (`rol` → `m`, anders → `stuks`). Import-script filtert leverancier_nr 20010 (Team snijtafel = interne orders) uit, en bepaalt eenheid per regel. Migratie 127 is nu **robuust tegen bestaande stub-tabellen** via `ALTER TABLE ADD COLUMN IF NOT EXISTS` per kolom (fix voor "column leverancier_nr does not exist" bij hergebruik). Nieuwe RPC `boek_voorraad_ontvangst(regel_id, aantal, medewerker)` voor vaste producten (hoogt `producten.voorraad` op i.p.v. rollen aan te maken). `boek_ontvangst` valideert nu dat regel eenheid=`m` heeft. `sync_besteld_inkoop` rekent alleen voor rol-producten om naar m², anders direct in stuks.
- **Waarom:** Karpi signaleerde dat Team snijtafel interne orders zijn (geen externe inkoop) en dat de Excel ook vaste-afmeting-orders bevat (stuks, geen meters). Eén kolom met ambigue betekenis (meters XOR stuks) vraagt om een eenheid-markering.
- **Cijfers na filter:** 21 leveranciers, 235 orders, 1.088 regels (235 rol-regels / 853 vast-regels), ~98.219 openstaand (m + st.).
- **Files:** [supabase/migrations/127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql), [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/components/inkooporders/voorraad-ontvangst-dialog.tsx](frontend/src/components/inkooporders/voorraad-ontvangst-dialog.tsx), [frontend/src/pages/inkooporders/inkooporder-detail.tsx](frontend/src/pages/inkooporders/inkooporder-detail.tsx).

### 2026-04-24 — Leveranciers, inkooporders en inkooporder_regels
- **Wat:** Migratie [127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql) maakt de tabellen `leveranciers`, `inkooporders` en `inkooporder_regels` + enum `inkooporder_status` + kolom `rollen.inkooporder_regel_id`. Views `leveranciers_overzicht` en `inkooporders_overzicht` aggregeren openstaande orders/meters per leverancier en per order. Trigger `trg_sync_besteld_inkoop` houdt `producten.besteld_inkoop` automatisch synchroon met de som van openstaande inkooporder-regels (omgerekend naar m² via `kwaliteiten.standaard_breedte_cm`). RPC `boek_ontvangst(regel_id, rollen[], medewerker)` maakt fysieke rollen aan, logt een `voorraad_mutaties`-entry van type `ontvangst` en zet de order-status op `Deels ontvangen`/`Ontvangen`.
- **Waarom:** Inkoopproces was alleen in docs gedefinieerd — geen tabellen, geen UI. Deze migratie brengt de documentatie en de werkelijkheid weer gelijk + voegt de ontvangst-flow toe.
- **Files:** [supabase/migrations/127_inkooporders_leveranciers.sql](supabase/migrations/127_inkooporders_leveranciers.sql).

### 2026-04-24 — Eenmalige import uit Inkoopoverzicht.xlsx
- **Wat:** Nieuw script [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py) dat de openstaande regels (Status ∈ {0, 1} én Te leveren > 0) uit `Inkoopoverzicht.xlsx` (83.301 rijen totaal) laadt: 22 leveranciers, 535 orders, 4.273 regels, ~107.191 m nog te leveren. Order-nr via `bouw_inkooporder_nr(oud_nr)` (formaat `INK-YYYY-NNNN`). Leverweek `'01/2049` en `'50/2017` worden gefilterd (alleen weken tussen 2024 en 2030 krijgen `verwacht_datum`). Draait dry-run standaard; `--apply` schrijft daadwerkelijk.
- **Waarom:** Karpi wil de openstaande inkooporders ook voor historische orders kunnen afvinken bij levering — die moeten eerst in de DB zitten. Afgeronde orders (Te leveren = 0) worden niet geïmporteerd (scope-keuze).
- **Files:** [import/import_inkoopoverzicht.py](import/import_inkoopoverzicht.py).

### 2026-04-24 — Frontend: leveranciers-tab + inkooporders-tab + ontvangst-modal + nieuwe-bestelling-form
- **Wat:** Nieuwe pagina's [leveranciers-overview.tsx](frontend/src/pages/leveranciers/leveranciers-overview.tsx) (lijst met openstaande orders/m² + actief-filter), [leverancier-detail.tsx](frontend/src/pages/leveranciers/leverancier-detail.tsx) (gegevens + openstaande orders), [inkooporders-overview.tsx](frontend/src/pages/inkooporders/inkooporders-overview.tsx) (filters op status, leverancier en alleen-open + stat-cards openstaand/deze-week/achterstallig), [inkooporder-detail.tsx](frontend/src/pages/inkooporders/inkooporder-detail.tsx) (regels met `Ontvangst`-knop per regel). Componenten [ontvangst-boeken-dialog.tsx](frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx) (N rollen per ontvangst met rolnummer/lengte/breedte) en [inkooporder-form-dialog.tsx](frontend/src/components/inkooporders/inkooporder-form-dialog.tsx) (nieuwe bestelling met regels-editor, genereert `INK-YYYY-NNNN` via `volgend_nummer('INK')`). Queries [leveranciers.ts](frontend/src/lib/supabase/queries/leveranciers.ts) + [inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts) en hooks [use-leveranciers.ts](frontend/src/hooks/use-leveranciers.ts) + [use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts). Placeholders in [router.tsx](frontend/src/router.tsx) vervangen door echte pagina's.
- **Waarom:** Karpi wil openstaande orders zien met verwachte leverdatum, kunnen afvinken bij binnenkomst (rollen komen dan automatisch in voorraad), en vanuit hier nieuwe bestellingen kunnen inboeken — zodat bij levering alleen nog afgevinkt hoeft te worden.
- **Files:** [frontend/src/pages/leveranciers/*](frontend/src/pages/leveranciers), [frontend/src/pages/inkooporders/*](frontend/src/pages/inkooporders), [frontend/src/components/inkooporders/*](frontend/src/components/inkooporders), [frontend/src/components/leveranciers/*](frontend/src/components/leveranciers), [frontend/src/hooks/use-leveranciers.ts](frontend/src/hooks/use-leveranciers.ts), [frontend/src/hooks/use-inkooporders.ts](frontend/src/hooks/use-inkooporders.ts), [frontend/src/lib/supabase/queries/leveranciers.ts](frontend/src/lib/supabase/queries/leveranciers.ts), [frontend/src/lib/supabase/queries/inkooporders.ts](frontend/src/lib/supabase/queries/inkooporders.ts), [frontend/src/router.tsx](frontend/src/router.tsx).

## 2026-04-22 — Snijplanning: operator-snijinstructies + snij-marges

### 2026-04-22 — Rol-uitvoer-modal: operator-terminologie + mes-nummering
- **Wat:** Shelf-header in [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) spreekt nu operator-taal: `Lengte-mes op Y cm` (afsnijden dwars over de rol) + `Breedte-mes 1/2/3 op X cm` (interne strip-verdelers), met maximaal 3 breedte-messen want dat is het machine-maximum. Een stuk dat groter geplaatst is dan besteld krijgt onder de maat een expliciete amber-regel `→ bijsnijden met hand naar X × Y cm` i.p.v. de voorheen grijze `(besteld …)`-hint.
- **Waarom:** De snijder aan de machine moet direct kunnen aflezen welke mes-standen hij moet instellen, in de terminologie die hij kent. Oude UI noemde de Y-afsnijding "breedtesnit" en de X-messen "mes-stand" — dat is exact omgekeerd van hoe de machine de messen benoemt.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-22 — Snij-marges: ZO +6 cm, rond/ovaal +5 cm
- **Wat:** Nieuwe SQL-functie `stuk_snij_marge_cm(afwerking, vorm)` in [migratie 126](supabase/migrations/126_snij_marges_zo_rond.sql) + TS-helper [snij-marges.ts](supabase/functions/_shared/snij-marges.ts). `snijplanning_tekort_analyse()` past de marge nu toe op de per-stuk rol-past-check (patched versie van migratie 117). `fetchStukken()` in de edge function past dezelfde marge toe zodat de packer met de fysieke snij-maat rekent, niet met de nominale. Bij combi ZO + rond wint de grootste marge (niet cumulatief).
- **Waarom:** Operator snijdt ZO-afwerking 6 cm groter (126×126 voor een 120×120 klant-stuk → rondom 6 cm voor de afwerking) en ronde stukken met 5 cm speling (voor handmatig uitzagen). Tekort-analyse en packer rekenden voorheen met de nominale maat → silent misplacement risk bij krappe rollen. Na deze change is een 320×230 ronde pas "passend" als de rol ≥ 325×235 is.
- **Impact:** Tekort-analyse kan voor sommige groepen nu een stuk als `grootste_onpassend` markeren dat voorheen "paste". Dat is correct gedrag, was eerder een hidden bug.
- **Files:** [supabase/migrations/126_snij_marges_zo_rond.sql](supabase/migrations/126_snij_marges_zo_rond.sql), [supabase/functions/_shared/snij-marges.ts](supabase/functions/_shared/snij-marges.ts) (+ test), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts).

### 2026-04-22 — Shelf-mes-validator (zachte planner-check)
- **Wat:** Nieuwe pure TS-module [shelf-mes-validator.ts](supabase/functions/_shared/shelf-mes-validator.ts) die per rol controleert hoeveel interne breedte-mes-posities een shelf vereist. Als > 3 (machine-maximum) → entry in `samenvatting.shelf_waarschuwingen` op de edge-function-response + `console.warn`. De `optimaliseer-snijplan` en `auto-plan-groep` edge functions roepen de validator na packing aan.
- **Waarom:** De UI toont max 3 breedte-messen, maar het packing-algoritme heeft die constraint niet. Zonder validator zou een theoretisch 5-strip-shelf silent een onuitvoerbaar plan opleveren. Zachte check — plaatsingen worden niet afgewezen, omdat een hardere constraint het scoring-pad raakt en een apart traject verdient.
- **Files:** [supabase/functions/_shared/shelf-mes-validator.ts](supabase/functions/_shared/shelf-mes-validator.ts) (+ test), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts).

## 2026-04-22 — Facturatie-module V1

Facturen worden automatisch gegenereerd + gemaild bij order-status 'Verzonden'
(klanten met `factuurvoorkeur='per_zending'`) of via wekelijkse cron (maandag 05:00 UTC,
voor klanten met `factuurvoorkeur='wekelijks'`). PDF volgens Karpi-layout, algemene
voorwaarden als tweede bijlage.

- Migraties 117–122: enums + tabellen facturen/factuur_regels, factuur_queue + trigger,
  RPC genereer_factuur, seed Karpi BV bedrijfsgegevens, queue-recovery, pg_cron
  (drain 1min + recovery 5min + wekelijks maandag 05:00 UTC).
- Kolommen `debiteuren.factuurvoorkeur` + `debiteuren.btw_percentage` toegevoegd
  (BTW per klant: 21% NL default, 0% voor EU-intracom/export).
- Edge function `factuur-verzenden` drainst queue: RPC → PDF (pdf-lib) → storage upload
  → Resend email met algemene voorwaarden als 2e bijlage.
- Pure helpers in `_shared/`: `factuur-bedrag.ts`, `factuur-pdf.ts`, `resend-client.ts`
  met Deno tests.
- Frontend: `/facturatie` lijst + detail, klant-detail tab "Facturering",
  `/instellingen/bedrijfsgegevens`, nieuwe sidebar-items.
- Secrets nodig: `RESEND_API_KEY`, `FACTUUR_FROM_EMAIL`, `FACTUUR_REPLY_TO`,
  `ALGEMENE_VOORWAARDEN_PATH`. Storage buckets: `facturen` (privé), `documenten` (public).
- Out of scope V1: herinneringen, aanmaningen, credit-nota's, partiële facturatie,
  herversturen-knop, automatische BTW-afleiding uit land.
- Plan: `docs/superpowers/plans/2026-04-22-facturatie-module.md`.

### 2026-04-22 — Levertijd-check: geen datums in het verleden meer
- **Wat:** Twee fixes in [check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts) + [levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts).
  1. **Primair** — `fetchWerkagendaInput` filtert nu `.in('status', PLANNING_STATUS_IN_PIPELINE)` (`'Gepland'` + `'Snijden'`) i.p.v. alleen `'Snijden'`, consistent met `fetchBestaandePlaatsingen`. Gepland-rollen krijgen daardoor een realistisch sequentieel werkagenda-slot (start ≥ vandaag) en de match-tak hoeft niet meer door te vallen naar de ongeflourde fallback.
  2. **Defense-in-depth** — `snijDatumVoorRol` floort uitkomst aan `volgendeWerkdag(vandaag)`: afleverdatum-pad én planning_week-pad retourneren nooit meer een datum in het verleden, ook niet wanneer de werkagenda om een of andere reden geen slot heeft.
- **Waarom:** Miguel meldde "Past op bestaande rol — leverdatum 06-04-2026" terwijl vandaag 22-04 is. Oorzaak: rol CISC11 3 stond op `Gepland` met een bestaande order die al overtijd was (afleverdatum 6-4). Werkagenda negeerde `'Gepland'` → match-tak viel terug op `snijDatumVoorRol(afleverdatum − buffer)` = 4-4-2026. Leverdatum = 6-4. Drie weken in het verleden.
- **Files:** [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-match.test.ts](supabase/functions/_shared/levertijd-match.test.ts) (+ 2 regressie-tests voor backlog scenarios), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-22 — Facturatie Task 8: PDF-generator met Karpi-layout (pdf-lib)
- **Wat:** `supabase/functions/_shared/factuur-pdf.ts` — server-side PDF-generatie voor Karpi BV facturen via `pdf-lib@1.17.1` (esm.sh). A4 portrait, Courier-font, volledige Karpi-layout: bedrijfs-header, klant-adresblok, info-blok, tabel-header, gegroepeerde orderregels per order_nr, TRANSPORTEREN/TRANSPORT BLAD bij paginering, BTW-blok, betalingscondities, gecentreerde footer (kvk/btw/bank/IBAN). Automatische pagina-ombreuk wanneer de cursor <40mm boven onderkant uitkomt. `supabase/functions/_shared/factuur-pdf.test.ts` — drie Deno-tests: magic-bytes (PDF-signature), 50-regeltest (paginering), 0%-BTW-test (intracom/export).
- **Waarom:** Task 8 van het facturatie-module plan. PDF wordt server-side gegenereerd (Deno Edge Function) zodat wekelijkse verzamelfacturen zonder actieve browser werken en als bijlage aan de Resend-mail gehangen kunnen worden.
- **Files:** [supabase/functions/_shared/factuur-pdf.ts](supabase/functions/_shared/factuur-pdf.ts), [supabase/functions/_shared/factuur-pdf.test.ts](supabase/functions/_shared/factuur-pdf.test.ts).

### 2026-04-22 — Edge Functions: verify_jwt=false voor publishable-key compat
- **Wat:** `supabase/config.toml` aangemaakt met `verify_jwt = false` voor `check-levertijd`, `auto-plan-groep` en `optimaliseer-snijplan` — de drie functies die vanuit de frontend via `supabase.functions.invoke()` worden aangeroepen.
- **Waarom:** De `sb_publishable_...` API-keyvorm (in `frontend/.env` als `VITE_SUPABASE_ANON_KEY`) is geen JWT. De Edge-gateway wijst het met `verify_jwt=true` af als `UNAUTHORIZED_INVALID_JWT_FORMAT` (HTTP 401). Resultaat: de real-time levertijd-check liet alleen de fallback-melding "Real-time levertijd-check niet beschikbaar" zien. De functies gebruiken intern `SUPABASE_SERVICE_ROLE_KEY` voor DB-toegang en lezen geen user-JWT — gateway-check was dus overbodig én blokkerend.
- **Handmatige actie:** Config.toml pakt alleen bij CLI-deploy. Directe fix via Supabase Dashboard → Edge Functions → [naam] → "Enforce JWT Verification" UIT voor elk van de drie functies.

### 2026-04-22 — Snijplanning: snij-volgorde gegroepeerd per shelf (fysieke guillotine-workflow)
- **Wat:** [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) groepeert de snij-volgorde nu in **shelves** (rijen langs de rol-lengte) met per rij een oranje header die de fysieke snij-instructie toont: "Rij N · breedtesnit op {yEnd} cm · lengtesnitten op {x1, x2, …} cm". Events binnen de shelf sorteren op X-positie (links→rechts lengtesnit-volgorde). Banding-tolerantie 5 cm voor afrondingen.
- **Waarom:** Miguel meldde dat het algoritme correct plant maar de UI de fysieke snij-workflow niet weerspiegelt. Op de Karpi snijtafel wordt een rol eerst één keer over de breedte gesneden (Y-as, "breedtesnit"), dan in de lengte (X-as, "lengtesnitten"). Mesinstelling voor de lengtesnit is de tijdrovende stap — twee stukken met dezelfde Y-positie willen opeenvolgend gesneden worden zodat de snijder het mes maar één keer hoeft in te stellen. Shelf-header maakt expliciet bij welke cumulatieve Y de breedtesnit moet vallen en welke X-grenzen daarna als lengtesnit gelden. Geen algoritmische verandering — dit is alleen presentatie, maar kritisch voor bruikbaarheid in de werkplaats.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-22 — Snijplanning: dead-zone awareness + free-rect-based reststukken
- **Wat (algoritme):** `findBestPlacement` in [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) gebruikt nu **dead-zone lexicografische scoring**: als de rol-rest na placement onder `AANGEBROKEN_MIN_LENGTE` (100 cm) zou zakken — en dus niet meer aanbreekbaar is — schakelt het criterium van "yEnd ↓" naar "reststuk-m² ↑". Safe-zone placements (die de rol aanbreekbaar houden) winnen altijd van dead-zone, en binnen elke zone gelden de eigen tiebreakers. `packRollGuillotine` krijgt `rolLengte` als expliciet argument om de dead-zone grens te bepalen.
- **Wat (reststuk-detectie):** Shelf-based `computeReststukken` vervangen door **free-rect subtraction + greedy disjoint cover** in beide locaties: [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts) en [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts). De oude shelf-reconstructie miste interne gaps (bv. combinatie rechter-strip + sliver onder korter stuk + end-strip werd in 3 afzonderlijke kleine rechthoeken gesplitst terwijl er één grote samenhangende rechthoek was). De nieuwe disjoint-cover claimt greedy de grootste kwalificerende rechthoek en subtraheerd die vóór de volgende iteratie — geen overlappende reststukken, maximaal bruikbare restwaarde.
- **Wat (UI-classificatie):** In `computeReststukkenAngebrokenAfval` worden full-width end-strips nu alleen als "aangebrokenEnd" geclassificeerd wanneer `lengte_cm ≥ AANGEBROKEN_MIN_LENGTE` (100 cm). Kortere full-width strips gaan door als normaal reststuk (met eigen rolnummer en sticker) zolang ze kwalificeren (≥ 50×100). Voorheen kwamen die strips in een "dode zone": niet aanbreekbaar (< 100 cm) én niet zichtbaar als reststuk → verloren bij `voltooi_snijplan_rol`.
- **Waarom:** Screenshot-scenario op rol IC2901TA13B (TAMA 13, 400×250 cm, 3 stukken 243×200 + 45×170 + 80×163) toonde "0 reststukken · 4 afval" terwijl er feitelijk een 400×50 end-strip (2 m² bruikbaar bij 50×100 drempel) én een interne 112×87 gap (0,97 m²) als reststuk hadden moeten verschijnen. Drie oorzaken: (1) UI verwijderde de 50-cm end-strip als onbruikbare aangebroken-rol terwijl die wél als reststuk kwalificeert, (2) shelf-based reststuk-detectie zag de 112×87 gap helemaal niet, (3) algoritme koos niet-dead-zone-aware tussen placement-opties. User's prioriteiten-hiërarchie: (1) reststukken gebruiken als bron → (2) max stukken per rol → (3) rol-lengte zuinig → (4) reststuk maximaliseren. In dead-zone valt prio 3 weg (rol gaat toch op), zodat prio 4 promoveert. Benchmark: 0 regressies over 10 scenarios, +2 reststukken op IC2901TA13B, alle eerdere winsten (391 cm) behouden.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [supabase/functions/_shared/compute-reststukken.test.ts](supabase/functions/_shared/compute-reststukken.test.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs).

### 2026-04-22 — Rollen-overzicht: placeholder-rollen voor ontbrekende maatwerk-paren

- **Wat:** "Rollen & Reststukken" toont nu álle maatwerk (kwaliteit, kleur) paren uit `maatwerk_m2_prijzen`, ook als er geen eigen voorraad is (bv. CISC 15). Lege groepen krijgen een "Leverbaar via [KWAL kleur] — N rollen, M m²"-badge wanneer `kwaliteit_kleur_uitwisselgroepen` een alternatief met voorraad aanwijst.
- **Waarom:** import van rollenvoorraad sloeg kwaliteiten zonder eigen voorraad over, waardoor leverbare maatwerk-varianten onzichtbaar waren.
- **Hoe:** migratie `112_rollen_placeholder_maatwerk.sql` — (a) idempotente INSERT van placeholder-rollen (`rolnummer = 'PH-{KWAL}-{KLEUR}'`, `oppervlak_m2 = 0`, `status = 'beschikbaar'`), (b) RPC `rollen_uitwissel_voorraad()` voor equiv-info. Frontend `fetchRollenGegroepeerd` mergt equiv op lege groepen; `RollenGroepRow` toont dim-state + badge.
- **Impact:** `leeg_op` stat-card stijgt met het aantal ingevoegde placeholders. Overige cijfers ongewijzigd. Geen snijplanning-impact (oppervlak=0 is onbruikbaar maar geldig).

### 2026-04-22 — Reststuk-drempel verlaagd naar 50×100 cm
- **Wat:** `RESTSTUK_MIN_SHORT` 70 → **50** en `RESTSTUK_MIN_LONG` 140 → **100** in alle 4 locaties: [supabase/functions/_shared/compute-reststukken.ts](supabase/functions/_shared/compute-reststukken.ts), [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs). Test-assertions + doc-references bijgewerkt.
- **Waarom:** Praktijkobservatie van Miguel op rol VERR130: een strook van 180×60 cm werd als afval geclassificeerd terwijl die in de werkplaats nog prima verkoopbaar is. Hogere drempel 70×140 was te strict voor Karpi's workflow — resulteerde in reststukken die fysiek naar de afvalbak gingen. Nieuwe drempel 50×100 sluit aan bij wat in praktijk nog herbruikbaar is voor kleine maatwerk-orders. Benchmark blijft 0 regressies, 391 cm rol-lengte bespaard; aantal gekwalificeerde reststukken stijgt (stress-test: +4 kwalificerende stukken t.o.v. oude drempel).
- **Files:** [compute-reststukken.ts × 2 + guillotine-packing.ts + vergelijk-snijalgoritmes.mjs + compute-reststukken.test.ts + snij-visualisatie.tsx + architectuur.md].

### 2026-04-22 — Snijplanning: reststuk-aware placement-scoring
- **Wat:** `findBestPlacement` in [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) gebruikt nu lexicografische scoring: (1) Y-eindpositie minimaal, (2) reststuk-m² maximaal, (3) kleinste vrije rechthoek eerst, (4) compactste leftover. Per kandidaat-placement wordt de volledige nieuwe free-rect-set gesimuleerd en het kwalificerende reststuk-oppervlak (≥70×140) meegerekend. De per-rol score tussen Guillotine- en FFDH-resultaat in `scorePacking` heeft nu ook een reststuk-m² term.
- **Waarom:** Op rol K1756006D (FIRE 20, 400×325) met stukken 310×220 + 40×80 werd het 40×80 stuk niet-geroteerd geplaatst — resultaat: 50×220 + 40×140 afval (1,66 m² verloren). Door stuk 2 geroteerd (80×40) te plaatsen ontstaat 10×40 afval + **90×180 reststuk** (1,62 m² bruikbaar). Zonder reststuk-term in de score miste het algoritme deze rotatie omdat beide varianten gelijk scoren op rol-lengte en afval-percentage. Benchmark ([scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs)) blijft 0 regressies, 3 winsten op rol-lengte (+391 cm totaal) én nu 1 extra reststuk-winst op K1756006D. Zonder Y-eind als primair criterium zou voorbeeld 2 regressie krijgen (560 → 660 cm): rol-lengte moet domineren over reststuk-theorie, anders rekt het algoritme de rol op om reststuk-waarde te forceren.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs).

### 2026-04-22 — Snijplanning: best-of-both packing (Guillotine + FFDH per rol)
- **Wat:** `packAcrossRolls` uit [_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts) vervangt de FFDH-only implementatie in beide edge functions ([auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts)). Per rol worden nu zowel een Guillotine-cut layout (Best Area Fit + Short Axis Split, met vrije rechthoeken als first-class state) als de klassieke FFDH shelf-layout berekend; het resultaat met meeste geplaatste stukken / kleinste rol-lengte / laagste afval wint. Reststuk-bescherming (`maxReststukVerspillingPct` uit `app_config.productie_planning`) en rol-sortering (reststukken vóór volle rollen) blijven ongewijzigd. [_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts) blijft als fundament bestaan.
- **Waarom:** FFDH scoorde per stuk op *gap-usefulness* i.p.v. totale rol-consumptie, wat zichtbaar werd op rol IC2900VE16A (LAMI 16): een 80×320 stuk landde op een nieuwe shelf onder een 240×340 terwijl het prima in de 160×340 vrije ruimte ernaast had gepast. Benchmark over 8 scenarios ([scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs)): 3 scenarios winst (voorbeeld 2: −100 cm = 4 m², klein-in-reststuk: −20 cm, 20 random stukken stress-test: −271 cm = 10,8 m²), 0 regressies, 5 gelijk. Totaal −391 cm rol-lengte over de testset. Reden voor de best-of-both wrapper i.p.v. pure Guillotine: een edge-case (smalle rol + strip-achtige stukken) waarin FFDH's rotatie-lookahead strikt wint — door beide te draaien nemen we dat gratis mee.
- **Files:** [supabase/functions/_shared/guillotine-packing.ts](supabase/functions/_shared/guillotine-packing.ts), [supabase/functions/_shared/guillotine-packing.test.ts](supabase/functions/_shared/guillotine-packing.test.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [scripts/vergelijk-snijalgoritmes.mjs](scripts/vergelijk-snijalgoritmes.mjs), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-22 — Snijplan-maten sync + auto-plan triggers uitgebreid
- **Migratie [110_snijplan_maten_sync.sql](supabase/migrations/110_snijplan_maten_sync.sql):** `auto_maak_snijplan()` gebruikte `COALESCE(NEW.maatwerk_lengte_cm, 100)` als default → snijplan werd 100×100 aangemaakt voor webshop-regels waar `parseMaatwerkDims()` niets uit de producttitel kon halen. Later werd de order_regel handmatig bijgewerkt met echte maten, maar het snijplan bleef 100×100 (geen UPDATE-trigger). Rol-toewijzingen op basis van 100×100 gaven verkeerde planning. Fix: hardcoded default weg (geen snijplan als maten NULL), plus nieuwe `auto_sync_snijplan_maten()` AFTER UPDATE-trigger op `order_regels` die `lengte_cm/breedte_cm` synchroon houdt. Maakt ook alsnog een snijplan als het bij INSERT was overgeslagen. Slaat update over als rol al toegewezen (RAISE WARNING) — handmatig releasen nodig.
- **Migratie [111_auto_plan_triggers_uitbreiden.sql](supabase/migrations/111_auto_plan_triggers_uitbreiden.sql):** migratie 100 dekte alleen INSERT op `rollen`. Nu twee extra statement-level triggers: (1) `snijplannen_auto_plan_na_insert` start auto-plan-groep wanneer een snijplan wordt aangemaakt (webshop-import, handmatig) via de gekoppelde order_regel's kwaliteit/kleur; (2) `rollen_auto_plan_na_status_update` vuurt wanneer een rol transiteert naar `beschikbaar`/`reststuk` (voorraad komt terug). Beide non-blocking via pg_net, zelfde advisory-lock patroon als migratie 100. Let op: PG staat geen kolomlijst (`OF status`) toe samen met transition tables → trigger vuurt op elke UPDATE en filtert zelf op status-transitie.
- **Backfill:** [scripts/backfill-snijplan-maten-sync.sql](scripts/backfill-snijplan-maten-sync.sql) corrigeerde 18 desync snijplannen (1 zonder rol, 17 met rol) en maakte 70 ontbrekende snijplannen aan voor order_regels waar is_maatwerk pas later op true gezet was. Voor 3 snijplannen met `rollen.snijden_gestart_op IS NOT NULL` zijn alleen de maten gecorrigeerd (rol behouden) omdat de rollen fysiek in productie waren; later alsnog gereset + herplanned omdat de posities op basis van 100×100 niet klopten.
- **Waarom:** snijplanning toonde systematisch 100×100 voor orders die via Lightspeed-import binnenkwamen en later handmatig van afmetingen werden voorzien. "Zou plannbaar moeten zijn — draai auto-plan opnieuw"-banners (de sky-blauwe `voldoende`-reden) waren het zichtbare symptoom van zowel de desync als de ontbrekende auto-plan-triggers bij nieuwe snijplannen en vrijkomende rollen.
- **Files:** [supabase/migrations/110_snijplan_maten_sync.sql](supabase/migrations/110_snijplan_maten_sync.sql), [supabase/migrations/111_auto_plan_triggers_uitbreiden.sql](supabase/migrations/111_auto_plan_triggers_uitbreiden.sql), [scripts/backfill-snijplan-maten-sync.sql](scripts/backfill-snijplan-maten-sync.sql).

### 2026-04-22 — Snijplanning: snij-volgorde toont consistent breedte × lengte
- **Wat:** In [rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) toonde de snij-rij `breedte_cm × lengte_cm` van het `SnijStuk`. Dat is in optimizer-conventie Y × X (langs × over de rol) — precies de inverse van de header (`rolBreedte × rolLengte (breedte × lengte)`) en van de reststuk-/aangebroken-rijen (die `ReststukRect` met `breedte_cm = X` gebruiken). Gefixt door lokaal naar UI-conventie (over × langs) te vertalen via `placedBreedte = snijStuk.lengte_cm`, `placedLengte = snijStuk.breedte_cm`. De `(besteld …)`-vergelijking is meegeswapt zodat hij alleen verschijnt als de geplaatste oriëntatie afwijkt van de klant-bestelde richting.
- **Waarom:** Klacht "bij Start snijden staat nog steeds niet alles structureel breedte × lengte". `SnijStuk` (uit [snijplan-mapping.ts:62](frontend/src/lib/utils/snijplan-mapping.ts#L62)) en `ReststukRect` (uit [compute-reststukken.ts:67](frontend/src/lib/utils/compute-reststukken.ts#L67)) gebruiken tegengestelde naamgeving; in de view-laag samenbrengen voorkomt het slepen aan twee parallelle producent-types.
- **Files:** [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx).

### 2026-04-20 — Op-maat: verkoopprijs_m2 fallback naar MAATWERK-artikelprijs
- **Migratie [107_kleuren_voor_kwaliteit_fallback_verkoopprijs.sql](supabase/migrations/107_kleuren_voor_kwaliteit_fallback_verkoopprijs.sql):** eerste poging — `verkoopprijs_m2` via COALESCE (eerst `maatwerk_m2_prijzen`, anders `producten.verkoopprijs` van het MAATWERK-artikel). Idem voor `equiv_m2_prijs`.
- **Migratie [108_kleuren_voor_kwaliteit_fallback_replace.sql](supabase/migrations/108_kleuren_voor_kwaliteit_fallback_replace.sql):** zelfde logica als 107 maar via `CREATE OR REPLACE` (geen DROP) voor veilige hercompilatie zonder view-dependencies te breken.
- **Migratie [109_kleuren_voor_kwaliteit_fallback_prioriteit.sql](supabase/migrations/109_kleuren_voor_kwaliteit_fallback_prioriteit.sql):** **fix**. De `eigen_maatwerk_artikel` CTE in 107/108 sorteerde op `(product_type='overig'?0:1), artikelnr` — bij VELV 16 won daardoor `771160017` (VELVET TOUCH Contour, `product_type='overig'`, verkoopprijs=NULL) van `771169998` (VELV16MAATWERK, €24,26). Gevolg: NULL in COALESCE en UI viel nog steeds terug op `equiv_m2_prijs` (€19,86). 109 prioriteert nu: (1) 'MAATWERK' in omschrijving/karpi_code, (2) verkoopprijs NOT NULL, (3) product_type='overig'. Zelfde fix ook toegepast op `uit_maatwerk_artikel` en `uit_m2_prijs` CTE's voor consistentie.
- **Waarom:** VELV 16 had geen `maatwerk_m2_prijzen`-rij → `verkoopprijs_m2` was NULL → UI toonde €19,86 (CISC-equivalent) terwijl VELV16MAATWERK zelf €24,26 heeft. Na 109 geeft `kleuren_voor_kwaliteit('VELV').verkoopprijs_m2` voor kleur 16 correct €24,26 terug.

### 2026-04-20 — Op-maat: uitwisselbare rol als alternatief bij 0 eigen voorraad
- **Wat:** Als een kwaliteit+kleur geen eigen rol heeft maar een uitwisselbare kwaliteit wél (via `kwaliteit_kleur_uitwisselgroepen`, zelfde `basis_code` + `variant_nr`), wordt dat nu automatisch voorgesteld in de Op-maat flow. Factuur houdt de bestelde kwaliteit (omstickeer-model); snijplan/voorraad landt op de uitwisselbare rol via `fysiek_artikelnr` + `omstickeren=true`. Voorbeeld: VELV 16 (geen rol) → CISC 16 (3 rol/138 m²), klant ziet VELV 16 op factuur.
- **Migratie [105_kleuren_voor_kwaliteit_uitwisselbaar.sql](supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql):** RPC `kleuren_voor_kwaliteit(p_kwaliteit)` herschreven. Retourneert nu ook kleuren die alleen via uitwisselgroep bereikbaar zijn, vult `equiv_rollen`/`equiv_m2` echt (was altijd 0) en drie nieuwe velden: `equiv_kwaliteit_code`, `equiv_artikelnr`, `equiv_m2_prijs`. Signatuurwijziging → DROP + CREATE.
- **Migratie [106_maatwerk_artikel_kwaliteit_kleur_backfill.sql](supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql):** backfill van 377 MAATWERK-artikelen (patroon `{KWAL}{KLEUR}MAATWERK`) die `kwaliteit_code=NULL, kleur_code=NULL` hadden. Zonder dit vond `fetchMaatwerkArtikelNr` het bestelde VELV16MAATWERK niet (kwaliteit-filter faalde) en viel onterecht door naar het CISC-alternatief. Alleen backfill als afgeleide code bestaat in `kwaliteiten` (respecteert FK).
- **Frontend:**
  - [op-maat.ts](frontend/src/lib/supabase/queries/op-maat.ts): `KleurOptie` uitgebreid met `equiv_kwaliteit_code` / `equiv_artikelnr` / `equiv_m2_prijs`.
  - [kwaliteit-first-selector.tsx](frontend/src/components/orders/kwaliteit-first-selector.tsx): afleiding `gebruiktUitwisselbaar` (0 eigen + uitwisselbaar beschikbaar); banner toont bron-kwaliteit; `handleAdd` zet `fysiek_artikelnr` + `omstickeren=true`; kleur-dropdown toont "+X m² via CISC"; `fetchKlantPrijs` heeft nieuwe fallback naar `producten.verkoopprijs` van het gevonden maatwerk-artikel (fijnmaziger dan generieke `maatwerk_m2_prijzen`-kwaliteitsrij).
- **Waarom:** de infrastructuur (`SubstitutionPicker`, `omstickeren`, uitwisselgroepen-tabel) bestond al, maar `kleuren_voor_kwaliteit` vulde `equiv_*` nooit in en MAATWERK-artikelen waren niet koppelbaar aan kwaliteit+kleur — de Op-maat flow kon dus niet signaleren dat een uitwisselbare rol als alternatief diende. Resultaat: bij VELV 16 zag men "0 m² totaal" en kon er geen orderregel gemaakt worden hoewel er 138 m² CISC 16 op rol stond.
- **Files:** [supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql](supabase/migrations/105_kleuren_voor_kwaliteit_uitwisselbaar.sql), [supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql](supabase/migrations/106_maatwerk_artikel_kwaliteit_kleur_backfill.sql), [frontend/src/lib/supabase/queries/op-maat.ts](frontend/src/lib/supabase/queries/op-maat.ts), [frontend/src/components/orders/kwaliteit-first-selector.tsx](frontend/src/components/orders/kwaliteit-first-selector.tsx).

### 2026-04-20 — snijplanning_tekort_analyse RPC hersteld (collecties-only)
- **Wat:** Migratie [102_snijplanning_tekort_analyse_restore.sql](supabase/migrations/102_snijplanning_tekort_analyse_restore.sql) zet de RPC `snijplanning_tekort_analyse()` terug die samen met migraties 078/079 uit de repo was verdwenen. Uitwisselbaarheid wordt nu puur via `kwaliteiten.collectie_id` bepaald (de fallback-pad uit de oude versie); de Map1-infrastructuur (`kwaliteit_kleur_uitwisselgroepen`-tabel + view `kwaliteit_kleur_uitwisselbaar`) komt niet terug. Kleur-match houdt de `.0`-suffix-normalisatie (zoeksleutel "13" ↔ "13.0"). Output-contract matcht de bestaande `TekortAnalyseRow`-interface in [snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts) — geen frontend-wijziging nodig.
- **Waarom:** Zonder de RPC retourneerde `supabase.rpc('snijplanning_tekort_analyse')` een permanente error en bleven de "Tekort"-accordions in de snijplanning-UI op "Analyse wordt geladen…" staan. Fijnmazige Map1-uitwisselbaarheid wordt bewust niet heringevoerd (eerder besloten per TAM→TAMA harmonisatie dat één kwaliteit-code per voorraadgroep voldoende is).
- **Files:** [supabase/migrations/102_snijplanning_tekort_analyse_restore.sql](supabase/migrations/102_snijplanning_tekort_analyse_restore.sql).

## 2026-04-20 — Confectie vooruitkijkende planning
- `afwerking_types.type_bewerking` kolom + FK naar `confectie_werktijden` (migratie 096)
- `confectie_werktijden.parallelle_werkplekken` kolom (migratie 097)
- Nieuwe view `confectie_planning_forward` met alle open maatwerk-stukken, backward-compat aliassen (migratie 098)
- Defensieve `ALTER TABLE snijplannen` voor `confectie_afgerond_op`, `ingepakt_op`, `locatie` (migratie 098)
- RPC's `start_confectie`, `voltooi_confectie` voor status-transities (migratie 101)
- Frontend: week-horizon selector (1/2/4/8 wk), capaciteitsbalken per lane, filter klaar-vs-alles op Lijst-tab
- `afrondConfectie()` nu via `voltooi_confectie` RPC
- Vitest + React Testing Library setup toegevoegd aan frontend
- **Waarom:** confectie kon alleen "al gesneden" werk zien — nu zijn overbelaste weken vooraf zichtbaar.

### 2026-04-20 — Auto-snijplanning triggert nu ook bij nieuwe rollen (niet alleen bij orders)
- **Wat:** Migratie [100_auto_plan_op_rol_insert.sql](supabase/migrations/100_auto_plan_op_rol_insert.sql) voegt een AFTER INSERT STATEMENT-level trigger op `rollen` toe die per unieke (kwaliteit_code, kleur_code)-combinatie een `pg_net.http_post` naar de [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) edge function afvuurt. Respecteert `app_config.snijplanning.auto_planning.enabled`; leest endpoint + auth-header uit dezelfde config-rij (velden `edge_url` / `auth_header`) zodat er geen secrets in de repo staan. Non-blocking via `EXCEPTION WHEN OTHERS`, edge function heeft eigen advisory lock. Eenmalige handmatige trigger uitgevoerd voor achterstallige groepen TAMA 13 (1 stuk) en TAMA 21 (4 stukken op 2 rollen).
- **Waarom:** Voorheen werd auto-planning alleen getriggerd bij order-aanmaak (zie [order-form.tsx:286-306](frontend/src/components/orders/order-form.tsx#L286-L306)). Wanneer maatwerk-orders als "tekort" geregistreerd stonden en er daarna nieuwe rollen binnenkwamen, bleef de tekort-analyse de orders als onplanbaar tonen — zelfs als de nieuwe voorraad technisch voldoende was. Een trigger op `rollen`-INSERT pakt nu zowel handmatige opboeking als bulk-imports automatisch op, en door STATEMENT-level (i.p.v. ROW-level) krijgen bulk-imports één call per kwaliteit/kleur i.p.v. per rol.
- **Setup:** Nog één keer na de migratie runnen: `UPDATE app_config SET waarde = jsonb_set(jsonb_set(waarde, '{edge_url}', to_jsonb('https://<ref>.supabase.co/functions/v1/auto-plan-groep'::text)), '{auth_header}', to_jsonb('Bearer <publishable-key>'::text)) WHERE sleutel = 'snijplanning.auto_planning';`
- **Files:** [supabase/migrations/100_auto_plan_op_rol_insert.sql](supabase/migrations/100_auto_plan_op_rol_insert.sql).

### 2026-04-20 — Productomschrijvingen gesync'd met kleur_code (karpi_code leidend)
- **Wat:** Migratie [099_omschrijvingen_kleur_consistency.sql](supabase/migrations/099_omschrijvingen_kleur_consistency.sql) vervangt "KLEUR X" in de omschrijving door de werkelijke `kleur_code` uit de karpi_code voor 4 producten waar deze afweken: AMBE25XX160230 (24→25), RENA45XX080300 (46→45), BUXV49180VIL (209→49), DOTT26500PPS (126→26). Regex behoudt originele kapitalisatie ("Kleur"/"KLEUR") via capture-group.
- **Waarom:** Diagnose-query toonde 4 data-inconsistenties waar productnaam en karpi-afgeleide kleur_code elkaar tegenspraken. Beslissing: karpi_code is leidend (= de autoritaire bron voor kwaliteit/kleur/breedte); omschrijving is presentatie en wordt daaraan aangepast. Voorkomt dat klanten/medewerkers de omschrijving zien als "waar" terwijl de snijplanning/voorraad op kleur_code werkt.
- **Files:** [supabase/migrations/099_omschrijvingen_kleur_consistency.sql](supabase/migrations/099_omschrijvingen_kleur_consistency.sql).

### 2026-04-20 — HAR1 + WLP1/WLP4 kleur_code-bug gerepareerd
- **Wat:** Migratie [098_har1_wlp_kleur_code_fix.sql](supabase/migrations/098_har1_wlp_kleur_code_fix.sql) herstelt de "3 letters + cijfer"-prefix-kleur-bug voor HAR1-producten (HARMONY — kleur_db `16/19/19` → `65/95/99`) en WLP1/WLP4-producten (WOOLPLUSH — kleur_db `11/41` → beide `18`). Alleen `kleur_code` + `zoeksleutel` worden bijgewerkt; `kwaliteit_code` (HAR / WLP) blijft gelijk — geen leverancier-switch zoals bij TAM→TAMA. Rollen worden gedenormaliseerd gesynchroniseerd. Pre/post-`NOTICE` telt afwijkingen tussen naam en kleur_code; post-telling moet 0 zijn.
- **Waarom:** Dezelfde bug als in migratie 096: de legacy-afleiding "eerste 2 cijfers uit karpi_code" pakt de prefix-cijfers mee zodra de prefix zelf een cijfer bevat. Zonder fix bleven deze rollen onzichtbaar voor zoeksleutel-gebaseerde voorraad-matching in de snijplanning. WLP1/WLP4 smelten hierdoor samen onder `zoeksleutel=WLP_18` (bewust, confirmed per user) — als ze later écht gesplitst moeten kan dat in een vervolgmigratie met aparte kwaliteiten.
- **Files:** [supabase/migrations/098_har1_wlp_kleur_code_fix.sql](supabase/migrations/098_har1_wlp_kleur_code_fix.sql).

### 2026-04-20 — Webshop: klantprijs uit prijslijst i.p.v. consumentprijs uit Lightspeed
- **Wat:** Nieuwe helper [supabase/functions/_shared/klant-prijs.ts](supabase/functions/_shared/klant-prijs.ts) haalt de debiteur-specifieke prijs op uit `prijslijst_regels` via `debiteuren.prijslijst_nr`. Voor maatwerk = m²-prijs × oppervlak (l×b/10000); voor standaard artikel = prijs per stuk. Fallback: `producten.verkoopprijs`; anders NULL (geen consumentprijs overschrijven). Beide edge functions ([sync-webshop-order](supabase/functions/sync-webshop-order/index.ts), [import-lightspeed-orders](supabase/functions/import-lightspeed-orders/index.ts)) gebruiken deze helper i.p.v. `row.priceIncl`. Backfill-script [scripts/backfill-floorpassion-klantprijs.mjs](scripts/backfill-floorpassion-klantprijs.mjs) corrigeerde 73 bestaande regels over Floorpassion-orders.
- **Waarom:** Floorpassion plaatst de order bij Karpi — de prijzen die Lightspeed meestuurt zijn consumentenprijzen van de webshop. Karpi factureert aan Floorpassion tegen de afgesproken prijslijst-tarieven (bv. LAGO19MAATWERK = €19,04/m² op prijslijst 0145). Voorbeeld ORD-2026-1683 regel 1: Lightspeed leverde €375 (consument); herberekend naar 270×140 × €19,04/m² = €71,97 (Karpi→Floorpassion).
- **Files:** [supabase/functions/_shared/klant-prijs.ts](supabase/functions/_shared/klant-prijs.ts), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/import-lightspeed-orders/index.ts](supabase/functions/import-lightspeed-orders/index.ts), [scripts/backfill-floorpassion-klantprijs.mjs](scripts/backfill-floorpassion-klantprijs.mjs).

### 2026-04-20 — Webshop: "Op maat"-orders altijd als maatwerk + `customFields: false`-guard
- **Wat:** Productmatcher in [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts) herkent "Op maat" / "Wunschgröße" / "Durchmesser" nu vroeg in het alias-pad en retourneert direct `is_maatwerk=true` — óók als de afmeting tijdelijk ontbreekt. Geen fallback meer naar "eerste hit op kwaliteit+kleur" bij expliciet maatwerk, want die matchte willekeurig op een standaard artikel (bijv. GLAM-19 080×150) waardoor de order-UI "Op maat" toonde zonder afmeting. Kwaliteit-disambiguïteit via `articleCode`: "LAGO19MAATWERK" levert nu LAGO-19 i.p.v. willekeurig GLAM (eerste alias-hit). [lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts) + scripts gebruiken `Array.isArray(customFields)`-guard want Lightspeed retourneert soms `customFields: false` (PHP-style) i.p.v. `null`/`[]` — die falsy waarde crashte `for (const f of false)`. Backfill-script [scripts/rematch-floorpassion-orders.mjs](scripts/rematch-floorpassion-orders.mjs) uitgebreid: selecteert nu óók regels met `is_maatwerk=false` waarvan `omschrijving_2` "Op maat"/"Wunschgr*"/"Durchmesser" bevat, zodat bestaande foutief-gematchte regels worden gecorrigeerd.
- **Waarom:** ORD-2026-1683 (Ross 19 — Op maat) toonde geen afmeting in de order-UI. Root cause: de deployed matcher kreeg geen customFields binnen (of crashte op `customFields: false`), waardoor sizeRaw leeg bleef en de "geen maat → eerste hit op kwaliteit+kleur"-fallback LAGO-19 → GLAM-19 080×150 koos. Fix voorkomt dat scenario doorverbinding: expliciet maatwerk mag nooit naar een standaard artikel gematcht worden. Dry-run backfill corrigeert 41 regels over 38 orders.
- **Files:** [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [supabase/functions/_shared/lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [scripts/rematch-floorpassion-orders.mjs](scripts/rematch-floorpassion-orders.mjs), [scripts/backfill-maatwerk-afmeting.mjs](scripts/backfill-maatwerk-afmeting.mjs).

### 2026-04-20 — TAM-kwaliteit geharmoniseerd naar TAMA (vervanger failliete leverancier)
- **Wat:** Migratie [096_tama_kwaliteit_harmoniseren.sql](supabase/migrations/096_tama_kwaliteit_harmoniseren.sql) repareert TAM1-producten op twee fronten: (1) `kwaliteit_code` 'TAM' → 'TAMA', (2) `kleur_code` herberekend op positie 5-6 van `karpi_code` (niet de eerste 2 cijfers — prefix 'TAM1' bevat zelf al een cijfer, waardoor de standaard-afleiding "11/12" pakte i.p.v. de werkelijke "13/21/23"). `zoeksleutel` mee-herberekend; bijbehorende rollen gedenormaliseerd meegeüpdatet. Pre/post-`RAISE NOTICE` met teltelling; fail-fast als kwaliteit 'TAMA' niet bestaat.
- **Waarom:** De oorspronkelijke BALTA-leverancier voor TAMAR is failliet; een vervanger levert functioneel dezelfde rollen onder prefix 'TAM1'. Zonder harmonisatie zag de snijplanning-tekort-analyse voor TAMA "geen voorraad" terwijl de TAM1-rollen fysiek in het magazijn liggen. Voorkeur voor samenvoegen in één kwaliteit-code boven het herinvoeren van de `kwaliteit_kleur_uitwisselgroepen` / Map1.xlsx-infrastructuur uit verwijderde migraties 078/079 — simpeler en genoeg voor deze casus.
- **Files:** [supabase/migrations/096_tama_kwaliteit_harmoniseren.sql](supabase/migrations/096_tama_kwaliteit_harmoniseren.sql).

### 2026-04-19 — Webshop-integratie live: webhooks + unmatched-vlag + slimmere matcher
- **Wat:** Lightspeed webhooks `orders/paid` zijn geregistreerd voor NL (id 4740622) + DE (id 4740623) — richten naar de live edge function `sync-webshop-order`. Productie-debiteur is **260000 "FLOORPASSION"** (bestaande rij; synthetische 99001 uit migratie 091 blijft ongebruikt). Migratie [094_orders_heeft_unmatched_regels.sql](supabase/migrations/094_orders_heeft_unmatched_regels.sql) voegt `orders.heeft_unmatched_regels BOOLEAN` toe + trigger op `order_regels` die de vlag automatisch onderhoudt bij inserts/updates/deletes. Backfill heeft 63 bestaande orders correct gevlagd. Edge function idempotency-check nu vóór Lightspeed-fetch verplaatst — dubbele webhooks hitten geen rate-limit meer. Matcher slim uitgebreid: herkent `VERZEND` (verzendkosten-regels), `[STAAL]` (Gratis Muster), `[MAATWERK]` (Wunschgröße / Op maat / Volgens tekening), `[MAATWERK-ROND]` (Durchmesser/rond), plus `parsed_karpi` via `kwaliteit+kleur+maat` parsing uit productTitle+variantTitle. Scripts [sync-webshop-orders.mjs](scripts/sync-webshop-orders.mjs) (polling, WATCH-mode) en [rematch-unmatched-webshop-regels.mjs](scripts/rematch-unmatched-webshop-regels.mjs) (backfill bestaande regels met nieuwe matcher). Na backfill: 91% van regels auto-gematched, resterende netjes gecategoriseerd via prefixen.
- **Waarom:** Piet/Hein moet dit weekend live testbestellingen kunnen plaatsen en ze direct in RugFlow zien verschijnen — webhook-registratie maakt dat real-time. De unmatched-vlag laat de orderlijst in één oogopslag zien welke orders review nodig hebben (anti-slip onderleggers, reinigingskits, custom sizes) zonder elke regel te openen. Prefix-matching (`[STAAL]` / `[MAATWERK]`) geeft de reviewer meteen context: "Gratis Muster" wil je anders behandelen dan "Wunschgröße 130x190 cm". De idempotency-volgorde-fix is belangrijk omdat Lightspeed aggressief retryt (tot 10×) — elke retry zou anders opnieuw de Lightspeed REST API aanspreken.
- **Files:** [supabase/migrations/094_orders_heeft_unmatched_regels.sql](supabase/migrations/094_orders_heeft_unmatched_regels.sql), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [scripts/sync-webshop-orders.mjs](scripts/sync-webshop-orders.mjs), [scripts/rematch-unmatched-webshop-regels.mjs](scripts/rematch-unmatched-webshop-regels.mjs), [docs/data-woordenboek.md](docs/data-woordenboek.md), [docs/database-schema.md](docs/database-schema.md), [docs/architectuur.md](docs/architectuur.md).

### 2026-04-17 — Lightspeed eCom webshop-integratie (fase 1: orders)
- **Wat:** Webhook-gebaseerde koppeling met Floorpassion NL + DE Lightspeed eCom shops. Migratie [091_floorpassion_verzameldebiteur.sql](supabase/migrations/091_floorpassion_verzameldebiteur.sql) zet verzameldebiteur 99001 = FLOORPASSION WEBSHOP. Migratie [092_orders_bron_tracking.sql](supabase/migrations/092_orders_bron_tracking.sql) voegt `bron_systeem` / `bron_shop` / `bron_order_id` toe aan orders met partial unique index (idempotentie) + nieuwe RPC `create_webshop_order`. Nieuwe edge function [sync-webshop-order](supabase/functions/sync-webshop-order/index.ts) ontvangt `orders/paid` webhooks, verifieert MD5-signature (shop-specifiek secret), fetcht de volledige order via Lightspeed REST API en maakt een order aan. Shared helpers: [lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [lightspeed-verify.ts](supabase/functions/_shared/lightspeed-verify.ts) (+ tests), [product-matcher.ts](supabase/functions/_shared/product-matcher.ts). Scripts: [register-lightspeed-webhooks.mjs](scripts/register-lightspeed-webhooks.mjs) (idempotent, registreert `orders/paid` per shop), [test-lightspeed-sync-local.mjs](scripts/test-lightspeed-sync-local.mjs) (smoke-test met fake webhook + geldige signature). Credentials in `supabase/functions/.env` (gitignored).
- **Waarom:** Karpi wil één backoffice voor alle orderstromen (B2B + webshop). Particuliere kopers krijgen geen eigen debiteur-rij; hun naam/adres landt als leveradres-snapshot op de order (consistent met bestaande orders-architectuur). Alleen `orders/paid` luisteren voorkomt dat onbetaalde winkelmandjes in productie komen. Unmatched producten blokkeren de order niet — regel wordt aangemaakt met `[UNMATCHED]` prefix en NULL `artikelnr` voor handmatige review. Partial unique index op (bron_systeem, bron_order_id) maakt Lightspeed-retries idempotent.
- **Files:** [supabase/migrations/091_floorpassion_verzameldebiteur.sql](supabase/migrations/091_floorpassion_verzameldebiteur.sql), [supabase/migrations/092_orders_bron_tracking.sql](supabase/migrations/092_orders_bron_tracking.sql), [supabase/functions/sync-webshop-order/index.ts](supabase/functions/sync-webshop-order/index.ts), [supabase/functions/_shared/lightspeed-client.ts](supabase/functions/_shared/lightspeed-client.ts), [supabase/functions/_shared/lightspeed-verify.ts](supabase/functions/_shared/lightspeed-verify.ts), [supabase/functions/_shared/lightspeed-verify.test.ts](supabase/functions/_shared/lightspeed-verify.test.ts), [supabase/functions/_shared/product-matcher.ts](supabase/functions/_shared/product-matcher.ts), [supabase/functions/.env.example](supabase/functions/.env.example), [scripts/register-lightspeed-webhooks.mjs](scripts/register-lightspeed-webhooks.mjs), [scripts/test-lightspeed-sync-local.mjs](scripts/test-lightspeed-sync-local.mjs), [docs/superpowers/plans/2026-04-17-lightspeed-webshop-orders.md](docs/superpowers/plans/2026-04-17-lightspeed-webshop-orders.md).

### 2026-04-17 — End-of-roll full-width = aangebroken rol, niet reststuk
- **Wat:** Migratie [090_voltooi_snijplan_rol_aangebroken.sql](supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql) voegt optionele param `p_aangebroken_lengte` toe aan `voltooi_snijplan_rol`. Als gezet (≥100 cm): originele rol behoudt rolnummer, lengte wordt verkort, status blijft `beschikbaar`, `rol_type` wordt via trigger op `aangebroken` gezet, voorraadmutatie `type='aangebroken'` wordt gelogd. Grondstofkosten-toerekening (088) trekt `aangebroken_m²` af van `afval_m²` zodat gesneden stukken niet de hele overgebleven lengte betalen. Frontend: nieuwe helper [computeReststukkenAngebrokenAfval](frontend/src/lib/utils/compute-reststukken.ts) splitst end-of-roll strip met volle breedte af als aparte `aangebrokenEnd` wanneer rol_type in ('volle_rol','aangebroken'); bij reststuk-rollen valt hij terug op oud reststuk-gedrag. [RolUitvoerModal](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) toont de regel met blauwe "Aangebroken" badge + tekst "behoud rol {rolnummer} (volle breedte)"; bij afsluiten wordt `aangebrokenLengte` doorgegeven aan `voltooi_snijplan_rol`.
- **Waarom:** Vervolg op 086/087. Bij OASI 11 (320 × 4620) werd na het snijden van 2 kleine stukken een full-width strip van 320 × 4110 als nieuwe reststuk-rol "OASI 11-R3" aangemaakt. Fysiek is dat gewoon de originele rol met een verkorte lengte. Met de aangebroken-flow blijft het rolnummer behouden, de oorsprong-keten klopt, en het voorraadoverzicht toont niet nodeloos versnipperde reststuk-rollen.
- **Files:** [supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql](supabase/migrations/090_voltooi_snijplan_rol_aangebroken.sql), [frontend/src/lib/utils/compute-reststukken.ts](frontend/src/lib/utils/compute-reststukken.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/lib/supabase/queries/snijvoorstel.ts](frontend/src/lib/supabase/queries/snijvoorstel.ts), [frontend/src/hooks/use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts).

### 2026-04-17 — Snijplan-status gesplitst in 'Gepland' + 'Snijden' (lock-semantiek hersteld)
- **Wat:** Migratie [089_snijplan_status_gepland_vs_snijden.sql](supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql) zet de status `'Gepland'` weer naast `'Snijden'`. `'Gepland'` = stuk toegewezen aan rol, cutlist aanpasbaar (`rollen.snijden_gestart_op IS NULL`). `'Snijden'` = rol fysiek onder het mes, bevroren. Trigger uit migratie 070 geïnverteerd: `'Wacht' → 'Gepland'`. Backfill: bestaande Snijden-stukken op rollen met `snijden_gestart_op IS NULL` → Gepland. RPC's aangepast: `keur_snijvoorstel_goed` zet op Gepland, `start_snijden_rol` promoot alle Gepland-stukken op die rol naar Snijden + timestamp, nieuwe `pauzeer_snijden_rol` unlockt (weigert als al Gesneden-stukken), `release_gepland_stukken` filtert direct op Gepland. Edge functions: [auto-plan-groep](supabase/functions/auto-plan-groep/index.ts) `statuses: ['Gepland', 'Wacht']`, [fetchBezettePlaatsingen](supabase/functions/_shared/db-helpers.ts) haalt Gepland-stukken, [check-levertijd](supabase/functions/check-levertijd/index.ts) `PLANNING_STATUS_IN_PIPELINE = ['Gepland', 'Snijden']`. Frontend: [SnijplanStatus type](frontend/src/lib/types/productie.ts) + [SNIJPLAN_STATUS_COLORS](frontend/src/lib/utils/constants.ts) uitgebreid met Gepland; alle status-filters accepteren beide. Pauzeer-knop in [rol-uitvoer-modal](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx) roept nu `pauzeer_snijden_rol` aan (was no-op).
- **Waarom:** Migraties 069/070 harmoniseerden Gepland+Snijden naar Snijden, waardoor het verschil tussen "gepland maar aanpasbaar" en "fysiek onder het mes" verloren ging. Gevolg: auto-plan kon geen stukken toevoegen aan al-geplande-maar-niet-gestarte rollen (gap-filling mislukte), overzicht toonde elk gepland stuk als 'Snijden' (verwarrend), en er was geen structurele pauzeer-actie. Concreet scenario: 100×100 FLOORPASSION belandde op een aparte rol terwijl OASI 11 nog een shelf-gap had. Met de splitsing blijft gap-filling werken tot iemand daadwerkelijk op "Start snijden" drukt, en "Pauzeer" geeft een rol weer vrij voor herplanning.
- **Files:** [supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql](supabase/migrations/089_snijplan_status_gepland_vs_snijden.sql), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/types/productie.ts](frontend/src/lib/types/productie.ts), [frontend/src/lib/utils/constants.ts](frontend/src/lib/utils/constants.ts), [frontend/src/lib/utils/snijplan-mapping.ts](frontend/src/lib/utils/snijplan-mapping.ts), [frontend/src/lib/supabase/queries/snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts), [frontend/src/lib/supabase/queries/snijvoorstel.ts](frontend/src/lib/supabase/queries/snijvoorstel.ts), [frontend/src/lib/supabase/queries/snijplanning-mutations.ts](frontend/src/lib/supabase/queries/snijplanning-mutations.ts), [frontend/src/hooks/use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts), [frontend/src/components/snijplanning/rol-uitvoer-modal.tsx](frontend/src/components/snijplanning/rol-uitvoer-modal.tsx), [frontend/src/components/snijplanning/groep-accordion.tsx](frontend/src/components/snijplanning/groep-accordion.tsx), [frontend/src/pages/snijplanning/productie-groep.tsx](frontend/src/pages/snijplanning/productie-groep.tsx), [frontend/src/pages/snijplanning/productie-rol.tsx](frontend/src/pages/snijplanning/productie-rol.tsx).

### 2026-04-17 — Grondstofkosten per snijplan bij rol-afsluiting
- **Wat:** Migratie [088_grondstofkosten_per_snijplan.sql](supabase/migrations/088_grondstofkosten_per_snijplan.sql) voegt drie kolommen toe aan `snijplannen`: `grondstofkosten` (€), `grondstofkosten_m2` (m² incl. afval-aandeel) en `inkoopprijs_m2` (snapshot bronrol). `voltooi_snijplan_rol` herschreven zodat bij elke rol-afsluiting het afval proportioneel over de zojuist gesneden stukken wordt verdeeld (`afval_m² = bronrol_m² − gesneden_m² − reststuk_m²`) en de kosten per snijplan worden ingevuld. Nieuwe reststuk-rollen krijgen nu óók `waarde` (oppervlak × bronrol-prijs-per-m²). Smoke-test in [scripts/test-grondstofkosten-rpc.sql](scripts/test-grondstofkosten-rpc.sql) met fixture 320×1000 cm rol, 3 stukken + 1 reststuk-rechthoek.
- **Waarom:** Nodig voor exacte winstmarge-berekening per orderregel. Weggegooid materiaal (bv. 50×270 cm naast een 270×270 rond) drukt op de stukken die nú worden gesneden, niet op toekomstige stukken uit reststukken. Reststukken gaan met correcte voorraadwaarde terug naar de voorraad — daarmee telt hun waarde mee in `dashboard_stats.voorraadwaarde_inkoop`. UI-koppeling (order-margin, rapportages) volgt in een vervolgplan.
- **Files:** [supabase/migrations/088_grondstofkosten_per_snijplan.sql](supabase/migrations/088_grondstofkosten_per_snijplan.sql), [scripts/test-grondstofkosten-rpc.sql](scripts/test-grondstofkosten-rpc.sql), [docs/database-schema.md](docs/database-schema.md).

### 2026-04-17 — Standaard rolbreedte per kwaliteit (bron van waarheid voor rol_type)
- **Wat:** Nieuwe kolom `kwaliteiten.standaard_breedte_cm` + seed voor 77 kwaliteiten o.b.v. modus-analyse over bestaande `volle_rol`-rollen ([086_kwaliteit_standaard_breedte.sql](supabase/migrations/086_kwaliteit_standaard_breedte.sql)). `bereken_rol_type()` herschreven naar STABLE met DB-lookup op `producten → kwaliteiten.standaard_breedte_cm`; fallback op oude artikelnr-heuristiek (laatste 3 cijfers), daarna 400 cm ([087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql](supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql)). Alle bestaande rollen opnieuw geclassificeerd.
- **Waarom:** Kwaliteiten als OASI/NOMA/RUBI/CAVA hebben artikelnummers zonder 3-cijferige breedte-suffix en rollen van 320 cm i.p.v. 400 cm. De oude heuristiek viel terug op 400 cm, waardoor 320 cm-rollen onterecht als `reststuk` werden geclassificeerd. Zichtbaar in het snij-modal van OASI 11 (320 × 4620) waar R3 (320 × 4110) als reststuk werd getoond terwijl het een aangebroken rol is. Met expliciete bron per kwaliteit is het onderscheid correct en kan de frontend-reststukken-logica (volgende stap) volle-breedte end-of-roll als aangebroken rol behandelen.
- **Files:** [supabase/migrations/086_kwaliteit_standaard_breedte.sql](supabase/migrations/086_kwaliteit_standaard_breedte.sql), [supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql](supabase/migrations/087_bereken_rol_type_gebruikt_kwaliteit_standaard.sql), [docs/database-schema.md](docs/database-schema.md), [docs/data-woordenboek.md](docs/data-woordenboek.md).

### 2026-04-17 — Auto-plan: shelf-gap-filling op deels-geplande rollen + max-reststuk-verspilling als filter
- **Wat:** Auto-plan-groep kan nu nieuwe stukken plaatsen in de shelf-gaps van rollen die al gedeeltelijk gepland zijn (status `in_snijplan`, productie nog niet gestart). Nieuwe helpers [reconstructShelves](supabase/functions/_shared/ffdh-packing.ts) en [fetchBezettePlaatsingen](supabase/functions/_shared/db-helpers.ts) + `packAcrossRolls({bezetteMap, maxReststukVerspillingPct})`. Sort-tier in [sortRolls](supabase/functions/_shared/ffdh-packing.ts) geeft rollen met bestaande plaatsingen voorrang boven verse rollen (gap-filling first). `app_config.productie_planning.max_reststuk_verspilling_pct` wordt nu ook door auto-plan gelezen: reststukken worden overgeslagen als hun afval na packing boven de drempel uitkomt. Migratie [085_keur_snijvoorstel_in_snijplan.sql](supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql) update `keur_snijvoorstel_goed` zodat die `in_snijplan`-rollen accepteert (mits `snijden_gestart_op IS NULL`). Tests in [ffdh-packing.test.ts](supabase/functions/_shared/ffdh-packing.test.ts).
- **Waarom:** In het praktijkvoorbeeld kreeg de 100×100 (FLOORPASSION, ORD-2026-0015) een eigen rol 1101 (320×1500) toegewezen, terwijl rol OASI 11 (320×4620) nog een shelf-gap van 150×170 had naast de reeds geplande 170×170 VAN DAM. Oorzaak: rollen met status `in_snijplan` werden uitgesloten van `fetchBeschikbareRollen`, dus latere auto-plan-rondes zagen de bestaande gaps niet. Gevolg: onnodig materiaalgebruik (hele rol aansnijden voor één klein stuk). De `max_reststuk_verspilling_pct` beschermt kleine voorraad-reststukken tegen overmatige verspilling.
- **Files:** [supabase/functions/_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts), [supabase/functions/_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [supabase/functions/auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql](supabase/migrations/085_keur_snijvoorstel_in_snijplan.sql), [supabase/functions/_shared/ffdh-packing.test.ts](supabase/functions/_shared/ffdh-packing.test.ts).

### 2026-04-17 — Dashboard KPI's omgehangen naar Goldratt TOC-framing (Inventory + Open verkooporders)
- **Wat:** Migratie [084_dashboard_stats_goldratt_toc.sql](supabase/migrations/084_dashboard_stats_goldratt_toc.sql) herformuleert twee KPI's volgens Theory of Constraints: `voorraadwaarde_inkoop` = **Inventory (I)** = `SUM(rollen.waarde)` excl. `status='verkocht'` (kapitaal vastgebonden aan inkoopprijs); `voorraadwaarde_verkoop` = **open verkooporders** = `SUM(totaal_bedrag) − SUM(VERZEND)` over orders met `status NOT IN ('Verzonden','Geannuleerd')` (pipeline die nog throughput gaat worden). Dashboard-kaarten hernoemd naar "Vastliggend in voorraad" en "Openstaande verkooporders". JSDoc in [dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) aangepast.
- **Waarom:** Miguel wil sturen via Goldratt's The Goal — zichtbaar hebben waar kapitaal vastzit (I) en welke order-commitments er nog open staan. De 083-definitie telde ook verkochte rollen en alle historische omzet, wat semantisch niet past bij TOC. Met de nieuwe definitie is I → T (Inventory wordt Throughput via openstaande orders) direct afleesbaar.
- **Files:** [supabase/migrations/084_dashboard_stats_goldratt_toc.sql](supabase/migrations/084_dashboard_stats_goldratt_toc.sql), [frontend/src/pages/dashboard.tsx](frontend/src/pages/dashboard.tsx), [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts).

### 2026-04-17 — Dashboard KPI's: voorraadwaarde (inkoop) over alle rollen + verkoop = orderomzet excl. verzend
- **Wat:** Nieuwe migratie [083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql) herdefinieert twee kolommen in `dashboard_stats`: `voorraadwaarde_inkoop` sommeert nu `rollen.waarde` over **alle** rollen (ongeacht status), en `voorraadwaarde_verkoop` is `SUM(orders.totaal_bedrag) − SUM(order_regels.bedrag WHERE artikelnr='VERZEND')` over niet-geannuleerde orders. Frontend ongewijzigd; dezelfde kolomnamen, andere betekenis. JSDoc-comments in [dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts) documenteren de nieuwe semantiek.
- **Waarom:** De oorspronkelijke view rapporteerde alleen voorraadwaarden van rollen met `status='beschikbaar'` en gebruikte `oppervlak × vvp` als verkoopwaarde — beide geven een vertekend beeld. Miguel wil (a) inkoopwaarde van alle tapijten in de database zien en (b) de daadwerkelijke gerealiseerde orderomzet zonder verzendkosten.
- **Files:** [supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql](supabase/migrations/083_dashboard_stats_nieuwe_voorraadwaarden.sql), [docs/database-schema.md](docs/database-schema.md), [frontend/src/lib/supabase/queries/dashboard.ts](frontend/src/lib/supabase/queries/dashboard.ts).

### 2026-04-17 — Backlog-drempel blokkeert levertijd niet meer (ASAP-by-default)
- **Wat:** [levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts) `resolveScenario` valt niet meer terug op `wacht_op_orders` wanneer `backlog.voldoende = false`. Bij een geldige match-cycle zonder bestaande rol-plek én voldoende voorraadmateriaal kiest de resolver direct `nieuwe_rol_gepland` met de eerstvolgende vrije snijweek. `wacht_op_orders` blijft uitsluitend bestaan voor `geen_rol_passend` (geen voorraadrol breed/lang genoeg → inkoop nodig). Test in [levertijd-resolver.test.ts](supabase/functions/_shared/levertijd-resolver.test.ts) bijgewerkt; backlog-info blijft zichtbaar in `details.backlog`.
- **Waarom:** Doelstelling is altijd "zo snel mogelijk leveren mits andere orders niet gehinderd worden". De backlog-drempel (12 m²) zorgde voor onnodig wachten ("vroegst 4 weken") terwijl er voorraadmateriaal beschikbaar was. Capaciteits-iteratie verschuift al naar volgende week als de huidige vol zit, dus order-hindering wordt nog steeds voorkomen. Praktijkvoorbeeld: ATELIER DIEUDONNEE order met 0 m² backlog kreeg 15-05-2026 ipv directe planning in eerstvolgende vrije week.
- **Files:** [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/functions/_shared/levertijd-resolver.test.ts](supabase/functions/_shared/levertijd-resolver.test.ts).

### 2026-04-16 — Lever_datum altijd op werkdag (skip weekend)
- **Wat:** Nieuwe helpers in [levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts): `naarWerkdag(iso)` schuift een datum vooruit naar de eerstvolgende ma-vr; `leverdatumVoorSnijDatum(snij, buffer)` combineert `+buffer kalenderdagen` met `naarWerkdag`. Toegepast op alle 4 lever_datum berekeningen (`kiesBesteMatch` in match, `nieuwe_rol_gepland` + `wacht_op_orders.vroegst_mogelijk` in resolver, `evalueerSpoed` in spoed-check). 5 nieuwe weekend-tests.
- **Waarom:** Bij snij-datum vrijdag + 2 dagen buffer landde de leverdatum op zondag — onmogelijk om te leveren. De UI toonde dat onterecht als geldige datum.
- **Files:** [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts).

### 2026-04-16 — Spoed-rejectie bij te-late backlog + buffer-aware teLaat
- **Wat:** [werkagenda.ts](supabase/functions/_shared/werkagenda.ts) `RolAgendaSlot` heeft nieuw verplicht veld `teLaat`. `berekenSnijAgenda` accepteert `snijLeverBufferDagen`-arg (default 2) en markeert een rol als `teLaat=true` zodra `eind > leverdatum − buffer`. [spoed-check.ts](supabase/functions/_shared/spoed-check.ts) rejecteert spoed direct met scenario `spoed_geen_plek` zodra ANY slot in de backlog `teLaat=true` is. [bereken-agenda.ts](frontend/src/lib/utils/bereken-agenda.ts) (frontend agenda-tab) gebruikt dezelfde buffer-logica zodat de rode "te laat"-markering ook al rollen vangt waar geen 2-dagen-buffer voor logistiek is. UI-bericht in `<SpoedToggle>` legt verschil uit tussen "planner zit al achter" en "beide weken vol".
- **Waarom:** De spoed-check beloofde nog plek deze week terwijl de bestaande backlog al rollen bevatte die op de leverdatum zélf gesneden werden (0 dagen buffer voor afwerking + verzending). Een spoed-belofte daarbovenop zou die rollen alleen nóg verder achter duwen. De nieuwe rejectie zegt eerlijk "planner zit al in nood, geen spoed mogelijk" en de Agenda-tab markeert deze rollen visueel als rood met `AlertTriangle`.
- **Files:** [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts), [supabase/functions/_shared/spoed-check.test.ts](supabase/functions/_shared/spoed-check.test.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/utils/bereken-agenda.ts](frontend/src/lib/utils/bereken-agenda.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx).

### 2026-04-16 — Spoed-optie bij levertijd-check
- **Wat:** `check-levertijd` retourneert nu een `spoed`-tak met `(beschikbaar, scenario, snij_datum, lever_datum, week_restruimte_uren, toeslag_bedrag)` gebaseerd op werk-restruimte deze + volgende ISO-week minus 4u buffer. UI toont een toggle in [`<LevertijdSuggestie>`](frontend/src/components/orders/levertijd-suggestie.tsx); bij activeren wordt de leverdatum overschreven en automatisch een `SPOEDTOESLAG`-orderregel toegevoegd (€50 default uit `app_config.productie_planning.spoed_toeslag_bedrag`). Spoed krijgt voorrang in de planning — de belofte-datum is de laatste werkdag van de gekozen week. Nieuwe shared module [`_shared/spoed-check.ts`](supabase/functions/_shared/spoed-check.ts) met 9 Deno unit tests; `werkagenda.ts` uitgebreid met `werkminutenTussen` voor netto-werkminuten-berekening.
- **Waarom:** Sales kan klanten met urgente verzoeken bedienen mits er capaciteit is, met transparante prijs-impact en zonder de planner handmatig te benaderen. De 4u buffer voorkomt dat planners onder druk komen wanneer een week bijna vol zit.
- **Files:** [supabase/migrations/082_app_config_spoed_velden.sql](supabase/migrations/082_app_config_spoed_velden.sql), [supabase/functions/_shared/spoed-check.ts](supabase/functions/_shared/spoed-check.ts), [supabase/functions/_shared/spoed-check.test.ts](supabase/functions/_shared/spoed-check.test.ts), [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [frontend/src/lib/constants/spoed.ts](frontend/src/lib/constants/spoed.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx), [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-16 — Order-aanmaak triggert auto-plan-groep + werkagenda-port voor levertijd-check
- **Wat:** Na succesvolle order-aanmaak (en update) roept [order-form.tsx](frontend/src/components/orders/order-form.tsx) `triggerAutoplan(kwaliteit, kleur)` aan voor elke unieke maatwerk-groep, mits `app_config.snijplanning.auto_planning.enabled = true`. Snijplanning-queries worden geïnvalideerd zodat de UI direct de nieuwe rol-toewijzingen toont. Failures zijn niet-blokkerend voor de order-aanmaak.
  Daarnaast: nieuwe shared module [werkagenda.ts](supabase/functions/_shared/werkagenda.ts) (Deno-port van `frontend/src/lib/utils/bereken-agenda.ts`) berekent de werkelijke snij-datum per rol uit de cumulatieve werkagenda (sortering op vroegste leverdatum + werktijden 08:00-17:00 ma-vr met 12:00-12:30 pauze). [check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts) gebruikt deze nu i.p.v. `afleverdatum − buffer`.
- **Waarom:** Voorheen kwam een nieuwe maatwerk-order in de "Tekort"-tab van snijplanning zonder rol-toewijzing — de auto-planning was wél globaal aan, maar werd alleen handmatig in de snijplanning-UI getriggerd. Daarnaast gaf de levertijd-check een datum die onnodig laat was (gebaseerd op de afleverdatum minus buffer), terwijl de werkelijke snij-datum eerder ligt in de actuele werkagenda. Voorbeeld CISC 11 300×200: oude check 04-05-2026, nieuwe check 24-04-2026.
- **Files:** [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx), [supabase/functions/_shared/werkagenda.ts](supabase/functions/_shared/werkagenda.ts), [supabase/functions/_shared/werkagenda.test.ts](supabase/functions/_shared/werkagenda.test.ts), [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts).

### 2026-04-16 — Fix levertijd-check: status-filter + afleverdatum-bron
- **Wat:** `PLANNING_STATUS_IN_PIPELINE` van `['Gepland', 'Wacht']` naar `['Snijden']` in [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts). Embedded select toegevoegd `order_regels(orders(afleverdatum))` om de werkelijke leverdatum mee te krijgen. `snijDatumVoorRol` gebruikt nu `afleverdatum − logistieke_buffer_dagen` als primaire bron, met `planning_week` als fallback.
- **Waarom:** Migratie 070 zet alle `'Gepland'` en `'Wacht'` snijplannen automatisch om naar `'Snijden'` (via trigger). Het oude filter matchte daardoor 0 records → altijd `wacht_op_orders` zelfs als er rollen met vrije ruimte op de planning stonden. Daarnaast zijn `snijplannen.planning_week` en `snijplannen.afleverdatum` in de praktijk altijd NULL; de echte leverdatum komt uit `orders.afleverdatum` via de FK-keten `snijplannen → order_regels → orders`.

### 2026-04-16 — Real-time levertijd-check bij order-aanmaak
- **Wat:** Nieuwe edge function `check-levertijd` ([supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts)) die tijdens order-entry een concrete leverdatum + onderbouwing berekent. Drie pure helper-modules (match/capacity/resolver) in [supabase/functions/_shared/levertijd-*.ts](supabase/functions/_shared/) met 58 Deno unit tests. Frontend integratie via `useLevertijdCheck`-hook (350 ms debounce, 60s staleTime) en `<LevertijdSuggestie>`-component, gerenderd in `order-form.tsx` na de header-grid voor de laatste maatwerk-regel. Migraties 080 (`backlog_per_kwaliteit_kleur` RPC) en 081 (`logistieke_buffer_dagen`, `backlog_minimum_m2` in `app_config.productie_planning`).
- **Waarom:** Sales communiceerde standaard "4 weken" zonder onderbouwing. De tool kent de planning-state (snijplannen + rollen + capaciteit + backlog) en kan nu vier scenario's onderscheiden: `match_bestaande_rol` (vroegste, hergebruikt restruimte), `nieuwe_rol_gepland` (capaciteit + backlog OK), `wacht_op_orders` (te weinig backlog of geen passende rol), `spoed` (gewenste datum < 2 dagen niet haalbaar). Hergebruikt FFDH `tryPlacePiece` uit [_shared/ffdh-packing.ts](supabase/functions/_shared/ffdh-packing.ts) voor restruimte-check op bestaande rol-plannen.
- **Files:** [supabase/functions/check-levertijd/index.ts](supabase/functions/check-levertijd/index.ts), [supabase/functions/_shared/levertijd-types.ts](supabase/functions/_shared/levertijd-types.ts), [supabase/functions/_shared/levertijd-match.ts](supabase/functions/_shared/levertijd-match.ts), [supabase/functions/_shared/levertijd-capacity.ts](supabase/functions/_shared/levertijd-capacity.ts), [supabase/functions/_shared/levertijd-resolver.ts](supabase/functions/_shared/levertijd-resolver.ts), [supabase/migrations/080_backlog_per_kwaliteit_kleur.sql](supabase/migrations/080_backlog_per_kwaliteit_kleur.sql), [supabase/migrations/081_app_config_levertijd_velden.sql](supabase/migrations/081_app_config_levertijd_velden.sql), [frontend/src/lib/supabase/queries/levertijd.ts](frontend/src/lib/supabase/queries/levertijd.ts), [frontend/src/hooks/use-levertijd-check.ts](frontend/src/hooks/use-levertijd-check.ts), [frontend/src/components/orders/levertijd-suggestie.tsx](frontend/src/components/orders/levertijd-suggestie.tsx), [frontend/src/components/orders/order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-15 — Tekort-analyse gebruikt Map1 uitwisselgroepen
- **Wat:** Migratie 079 herschrijft `snijplanning_tekort_analyse()` zodat primair de Map1-tabel (via `kwaliteit_kleur_uitwisselbaar`) wordt gebruikt en pas terugvalt op `collecties` als het input-paar niet in Map1 staat. `heeft_collectie=true` zodra Map1 óf collectie uitwisselbaarheid kent; `uitwisselbare_codes` komt uit Map1-paren wanneer beschikbaar.
- **Waarom:** De "Tekort"-tab toonde onterecht "Geen collectie gekoppeld aan kwaliteit FEAT" en "Geen voorraad in uitwisselbare kwaliteiten (CAST, CISC, SPRI, VELV) voor kleur 15" terwijl Map1 deze groepen wel definieert (FEAT13→GENT13, VELV15→CISC15).
- **Files:** [079_tekort_analyse_uitwisselgroepen.sql](supabase/migrations/079_tekort_analyse_uitwisselgroepen.sql).

### 2026-04-15 — Fijnmazige uitwisselbaarheid (Map1.xlsx → snijplanning)
- **Wat:** Nieuwe tabel `kwaliteit_kleur_uitwisselgroepen` (PK `(kwaliteit_code, kleur_code, variant_nr)`, groeperend op `basis_code`) en view `kwaliteit_kleur_uitwisselbaar`. Migratie 078. Importscript `import/import_uitwisselgroepen.py` leest `Map1.xlsx` (573 rijen, 274 basis-groepen, 92 met meerdere leden). Edge-functies `optimaliseer-snijplan` en `auto-plan-groep` gebruiken nu `fetchUitwisselbarePairs` als primaire bron voor uitwisselbaarheid en filteren rollen via expliciete `(kwaliteit,kleur)`-paren (`.or(and(...),and(...))`). Valt terug op `collecties` wanneer het input-paar niet in de tabel staat.
- **Waarom:** Het oude `collecties`-model groepeert te permissief (alle kwaliteiten in dezelfde collectie + zelfde kleur). Map1 definieert de werkelijke uitwisselbaarheidsgroepen op `(kwaliteit, kleur)`-niveau (bv. binnen 1VRIJ horen `ANNA11` en `BREE11` samen, maar `BABY12` in een eigen groep).
- **Files:** [078_kwaliteit_kleur_uitwisselgroepen.sql](supabase/migrations/078_kwaliteit_kleur_uitwisselgroepen.sql), [import/import_uitwisselgroepen.py](import/import_uitwisselgroepen.py), [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [optimaliseer-snijplan/index.ts](supabase/functions/optimaliseer-snijplan/index.ts), [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts).

### 2026-04-15 — Auto-planning: filter op rol_id IS NULL in fetchStukken
- **Wat:** `fetchStukken` in [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts) filtert nu óók op `rol_id IS NULL`. Fout-afhandeling in [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts) serialiseert PostgrestError-objecten (die geen `Error`-instance zijn) correct naar `message + detail + hint + code`. Het runnerscript [scripts/eenmalig-auto-plan-alle-groepen.mjs](scripts/eenmalig-auto-plan-alle-groepen.mjs) toont extra error-velden en vangt onverwachte responses af.
- **Waarom:** Voor VELV 13 faalde auto-plan met `Auto-plan fout: [object Object]`. Oorzaak: `fetchStukken` trok snijplannen op met status='Snijden' zonder filter op `rol_id`. Voor VELV 13 waren 5 plannen al eerder toegewezen aan rol 1755 (legacy/stale state); het voorstel bevatte plaatsingen voor die plannen, waarna de guard in `keur_snijvoorstel_goed` ("Niet alle snijplannen zijn nog onaangetast") terecht weigerde. De filter `rol_id IS NULL` stemt `fetchStukken` af op wat de guard verwacht en op de tekort-analyse.
- **Files:** [_shared/db-helpers.ts](supabase/functions/_shared/db-helpers.ts), [auto-plan-groep/index.ts](supabase/functions/auto-plan-groep/index.ts), [scripts/eenmalig-auto-plan-alle-groepen.mjs](scripts/eenmalig-auto-plan-alle-groepen.mjs).

### 2026-04-15 — Snijplanning KPI-cards: horizon + deze week
- **Wat:** De 4 oude stat-cards (Wacht op planning / Gepland / Gesneden / In confectie) op de snijplanning-overview zijn vervangen door 3 horizon-gerichte KPI's: (1) "Binnen horizon (N wkn)" = snijplannen met status `Snijden` binnen `weken_vooruit`, (2) "Te snijden deze week" = status `Snijden` + afleverdatum in huidige kalenderweek (ma–zo), (3) "Gesneden deze week" = status `Gesneden` + `gesneden_op` in huidige week. Nieuwe query `fetchSnijplanningKpis(totDatum)` ([snijplanning.ts](frontend/src/lib/supabase/queries/snijplanning.ts)) draait 3 `head: true` count-queries parallel; nieuwe hook `useSnijplanningKpis`.
- **Waarom:** De oude cards aggregeerden over álle snijplannen (ook buiten de horizon) waardoor getallen niet klopten met de zichtbare lijst, en gaven geen operationele focus. De snijder wil weten: hoeveel staat er in de pijplijn, wat moet déze week klaar, en hoeveel is er al gedaan.

### 2026-04-15 — Kleur_code normalisatie (strip trailing ".0")
- **Wat:** Migratie 077 strippt trailing `.0` uit `kleur_code` in `rollen`, `producten` (+ `zoeksleutel` herberekend), `order_regels.maatwerk_kleur_code`, `snijvoorstellen`, `snijplan_groep_locks` (composite PK) en `maatwerk_m2_prijzen` (UK). Bij UK/PK-botsingen wordt de `.0`-rij verwijderd als de genormaliseerde variant al bestaat. CHECK-constraints voorkomen dat trailing `.0` opnieuw binnenkomt. De helper-functie `normaliseer_kleur_code(TEXT)` wordt idempotent aangemaakt. Frontend [rollen.ts](frontend/src/lib/supabase/queries/rollen.ts) `fetchRollenGegroepeerd` laat de `.0`-variant-fallback in `kleurFilter` vallen.
- **Waarom:** Dezelfde kleur verscheen dubbel in de rollen-voorraad-UI (bv. `VELV 10` én `VELV 10.0`, `GOKI 13.0`) doordat legacy data inconsistent was. Groepering in de UI is exact-match op string; normalisatie in de database is de enige duurzame fix.
- **Files:** [077_normaliseer_kleur_code.sql](supabase/migrations/077_normaliseer_kleur_code.sql), [rollen.ts](frontend/src/lib/supabase/queries/rollen.ts).

### 2026-04-15 — Order bewerken: FK-conflict met snijplannen opgelost + afleverdatum-override
- **Wat:** Migratie 074 schrijft `update_order_with_lines` RPC om van "DELETE alle regels + INSERT opnieuw" naar een merge-strategie: bestaande regels worden ge-UPDATE op `id`, nieuwe regels worden ge-INSERT, en alleen regels die uit de payload verdwenen zijn worden verwijderd. `OrderRegelFormData` bevat nu een optioneel `id`-veld; `order-edit.tsx` geeft de originele regel-ids door aan het formulier. In `order-form.tsx` is een nieuwe `afleverdatumOverridden`-state toegevoegd: zodra de gebruiker de afleverdatum handmatig wijzigt, wordt de auto-berekening (op basis van klant-levertermijn en regels) overgeslagen. Error-rendering in de form toont nu ook niet-`Error`-objecten (supabase geeft `{message, ...}`) zodat Postgres-foutmeldingen zichtbaar worden i.p.v. de generieke "Er ging iets mis".
- **Waarom:** (1) Bij het bewerken van een order waarvan regels al gekoppeld waren aan een snijplan viel de save om op `snijplannen_order_regel_id_fkey` — de delete-and-reinsert strategie botste met de FK zonder ON DELETE. Door regels op id te updaten blijft de koppeling intact. (2) De auto-herberekening van de afleverdatum overschreef handmatige aanpassingen telkens wanneer orderregels muteerden; de override-vlag lost dat op en respecteert de expliciete keuze van de gebruiker.
- **Files:** [074_update_order_with_lines_merge.sql](supabase/migrations/074_update_order_with_lines_merge.sql), [order-mutations.ts](frontend/src/lib/supabase/queries/order-mutations.ts), [order-edit.tsx](frontend/src/pages/orders/order-edit.tsx), [order-form.tsx](frontend/src/components/orders/order-form.tsx).

### 2026-04-15 — Planning-horizon: één bron van waarheid (`weken_vooruit`)
- **Wat:** De planning-horizon voor de snijplanning komt nu uitsluitend uit `planningConfig.weken_vooruit` (Productie Instellingen). Dit filter is altijd actief — groepen met leverdatum voorbij de horizon verdwijnen uit de lijst. `AutoPlanningConfig.horizon_weken` is verwijderd (type, default, UI); auto-planning leest de horizon óók uit `planningConfig` wanneer enabled. Snijplanning-header toont nu zichtbaar de actieve horizon (bv. "horizon 4 weken (t/m 13-05-2026)").
- **Waarom:** Eerder stond de `weken_vooruit`-instelling in Productie Instellingen als UI-dummy: de daadwerkelijke filter gebruikte `autoConfig.horizon_weken` en werd alleen toegepast als auto-planning enabled was. Verwarrend en inconsistent. Nu geldt: wat de gebruiker in Instellingen configureert, is wat er filtert.
- **Files:** [snijplanning-overview.tsx](frontend/src/pages/snijplanning/snijplanning-overview.tsx), [use-snijplanning.ts](frontend/src/hooks/use-snijplanning.ts), [auto-planning.ts](frontend/src/lib/supabase/queries/auto-planning.ts), [auto-planning-config.tsx](frontend/src/components/snijplanning/auto-planning-config.tsx).

## 2026-04-15 — Rollenvoorraad gesynchroniseerd
- Script: `import/sync_rollen_voorraad.py` (dry-run + `--apply`)
- Bron: `Rollenvoorraad per 15042026.xlsx` (1428 unieke rollen)
- Nieuw: 159, geüpdatet: 140, afgevoerd (status `verkocht`): 28, beschermd overgeslagen: 93
- Beschermde rollen hebben workflow-status (`in_snijplan`/`gereserveerd`/`gesneden`) en zijn niet aangeraakt
- Let op: afvoer-status is `'verkocht'` (niet `'geen_voorraad'` — bestaat niet als geldige DB-waarde; check constraint `rollen_status_check` staat alleen toe: `beschikbaar`, `gereserveerd`, `verkocht`, `gesneden`, `reststuk`, `in_snijplan`)

### 2026-04-15 — Testdata refresh: orders-2026 (toekomstige afleverdatum + maatwerk)
- **Wat:** Migratie 068 voegt RPC `admin_truncate_orders()` toe (TRUNCATE orders + order_regels CASCADE). Nieuw script [import/reimport_orders_2026.py](import/reimport_orders_2026.py) leest `orders-2026.xlsx`, filtert op order-niveau (behoud alleen orders waarvan `min(afleverdatum) > vandaag`), vraagt interactieve `WIS`-bevestiging, en laadt de gefilterde set opnieuw (orders + order_regels). Bevat `parse_maatwerk()`: regels met `karpi_code *MAATWERK` krijgen automatisch `is_maatwerk=true` + `maatwerk_vorm` (rechthoek / rond / ovaal) + `maatwerk_lengte_cm` + `maatwerk_breedte_cm` uit de artikel-omschrijving (bv `VERR18XX400260` → 400×260 rechthoek, `VELV15XX200RND` → Ø200 rond). Producten-lookup gepagineerd (fix: eerder slechts 1000/27068 opgehaald waardoor 96% artikelnrs op NULL eindigden). Eenmalige SQL backfill: `UPDATE producten SET kwaliteit_code = LEFT(r.karpi_code,4), kleur_code = SUBSTRING(r.karpi_code FROM 5 FOR 2) FROM order_regels r WHERE p.artikelnr=r.artikelnr AND p.kwaliteit_code IS NULL`. Resultaat: 365 orders / 615 regels, waarvan 323 maatwerk; na auto-plan-groep batch zijn 40 kwaliteit/kleur-groepen gepland op rollen (110 geskipt — geen voorraad).
- **Waarom:** Demo-dataset bevatte veel orders met afleverdatum in het verleden waardoor flows (snijplanning, confectie-planning) niet getest konden worden. Met alleen toekomstige orders + correct gemarkeerde maatwerk is de testomgeving bruikbaar.
- **Impact:** Downstream tabellen (`snijplannen`, `snijplan_groepen`, `snijplan_rollen`, `kleuren`, `confectie_planning`, rol-koppelingen) zijn geleegd via CASCADE. Bekende gaps: (1) auto_maak_snijplan trigger zet nog status `'Wacht'`, terwijl `snijplanning_groepen_gefilterd` RPC `totaal_snijden` telt — werkt toch omdat `auto-plan-groep` edge function nog op `'Wacht'` zoekt; toekomstige migratie moet deze statussen harmoniseren. (2) `producten.is_maatwerk` bestaat niet als kolom; maatwerk-detectie gebeurt alleen op order_regel-niveau via karpi_code-suffix.

### 2026-04-15 — Levertermijn per type (standaard/maatwerk) + deelleveringen
- **Wat:** Migratie 067 vervangt `debiteuren.standaard_levertermijn_weken` door twee aparte velden `standaard_maat_werkdagen` en `maatwerk_weken`, en voegt `deelleveringen_toegestaan` boolean toe. `app_config.order_config` bevat nu `{standaard_maat_werkdagen:5, maatwerk_weken:4}`. Nieuwe pure util [afleverdatum.ts](frontend/src/lib/utils/afleverdatum.ts) berekent per type de datum en de langste. `OrderForm` recalculeert afleverdatum bij elke klant-wissel én orderregel-mutatie op basis van `is_maatwerk` per regel; toont bij gemengde orders beide subdatums als hint. Bij klant met `deelleveringen_toegestaan=true` en gemengde order verschijnt een checkbox "Deelleveringen" (default aan) — bij aanmaken wordt de order gesplitst in 2 losse `createOrder()` calls (standaard + maatwerk), verzendkosten-regel gaat mee met de standaard-order, navigatie naar orders-lijst in plaats van detail. Instellingen-pagina en klant-detail-header zijn uitgebreid met de nieuwe velden (2 aparte overrides + toggle).
- **Waarom:** Eén globale levertermijn dekte de praktijk niet: voorraad-karpetten leveren we binnen 5 dagen uit, maatwerk duurt ~4 weken. Bij gemengde orders wil Karpi de keuze geven om te splitsen zodat het standaard-deel niet hoeft te wachten op het maatwerk.

### 2026-04-15 — Rol-uitvoer flow: start/afvinken/sluiten met tijdregistratie
- **Wat:** Nieuwe "Start met rol"-knop op productie-groep (`productie-groep.tsx`) en snijplanning-accordion (`week-groep-accordion.tsx`) opent `RolUitvoerModal` (nieuw `rol-uitvoer-modal.tsx`). Modal toont snij-visualisatie + lijst stukken met checkboxes (default aangevinkt), per-stuk sticker-print en bulk-print, en "Rol afsluiten" knop. Bij openen registreert een idempotente RPC `start_snijden_rol` de starttijd. Bij afsluiten worden alléén afgevinkte snijplannen als `Gesneden` gemarkeerd; niet-afgevinkte stukken gaan terug naar `Wacht` (rol_id/positie gereset) zodat ze automatisch in de volgende optimalisatie-run meedraaien. Reststukken worden berekend op basis van alléén afgevinkte stukken. Migraties 063 (kolommen `snijden_gestart_op`/`snijden_voltooid_op`/`snijden_gestart_door` op rollen), 064 (`start_snijden_rol` RPC), 066 (`voltooi_snijplan_rol` uitgebreid met `p_snijplan_ids BIGINT[]`). Oude 2-stappen flow "Start productie" → "Rol gesneden" vervangen door één knop + modal.
- **Waarom:** Eerdere flow kon alleen in één keer de hele rol afvinken — geen per-stuk afvinken, geen manier om een rol te sluiten met slechts een deel gesneden, en geen starttijd-registratie. De modal sluit aan bij de werkpraktijk: medewerker start rol, vinkt af wat hij daadwerkelijk snijdt, print stickers direct, sluit rol af — en wat niet lukte rolt automatisch mee naar de volgende run. Start/eind-timestamps op rol-niveau maken latere tijdanalyse (snijduur per rol) mogelijk.
- **Impact:** Migraties 063/064/066; nieuwe kolommen op `rollen`; nieuwe RPC + uitgebreide signatuur van `voltooi_snijplan_rol` (backwards compatible — `p_snijplan_ids=NULL` behoudt oud gedrag). Route `/snijplanning/productie/{rolId}` blijft bestaan maar wordt niet meer gelinkt vanaf de hoofd-flow.

### 2026-04-15 — Standaard levertermijn (globaal + per klant)
- **Wat:** Migratie 061 voegt kolom `debiteuren.standaard_levertermijn_weken` (INTEGER NULL) toe en seedt `app_config.order_config = {"standaard_levertermijn_weken": 1}`. Nieuwe query-module `order-config.ts` (fetch/update globale config). Instellingen-pagina kreeg Card "Order-instellingen" met numeric input voor globale default (weken). Klant-detailpagina kreeg inline "Standaard levertermijn"-veld (NULL = valt terug op globaal). `OrderForm.handleClientChange` vult bij klant-selectie automatisch `afleverdatum = vandaag + N×7 dagen` (N = klant-override ?? globaal ?? 1), alleen als afleverdatum nog leeg is zodat handmatige keuzes niet worden overschreven. `ClientSelector` selecteert nu ook `verzendkosten`, `verzend_drempel`, `standaard_levertermijn_weken`.
- **Waarom:** De afleverdatum was telkens handmatig werk; in de praktijk heeft elke klant een vrij vaste levertermijn. Met een globale default + per-klant override komt de datum automatisch goed.

### 2026-04-15 — Meerdere reststukken per gesneden rol
- **Wat:** Nieuwe util `compute-reststukken.ts` (backend Deno + frontend kopie) berekent álle rechthoekige restgebieden uit een FFDH-layout: rechter-strip per shelf, onder-sliver per kort stuk, en end-of-roll strip. Filter: ≥ 70×140 cm = bruikbaar reststuk, kleiner = afval. `optimaliseer-snijplan` voegt `reststukken[]` toe aan elke rol in de response. `SnijVisualisatie` rendert elk reststuk als groen-omlijnde box met afmetinglabel. Migratie 060 breidt `voltooi_snijplan_rol()` uit met JSONB-parameter `p_reststukken` zodat per kwalificerend rechthoek een rol-record met `status='beschikbaar'` + `oorsprong_rol_id` wordt aangemaakt (rolnummer = `<rol>-R1`, `-R2`, …). Productie-rol/groep tonen alle gegenereerde reststuk-stickers ineens; oude `ReststukBevestigingModal` is uit deze flow verwijderd. `SnijRolVoorstel` en `SnijvoorstelRol` types kregen optioneel veld `reststukken: ReststukRect[]`.
- **Waarom:** Eerder werd alleen de end-of-roll strip als reststuk geregistreerd; alle ruimte naast geplaatste stukken (bv. 80×300 strip naast een 320×300 stuk op een rol van 400 breed) ging verloren als afval. Karpi wil maximale herbruikbaarheid: elk rechthoek dat groot genoeg is voor toekomstig werk moet voorraad worden met eigen QR-sticker.

### 2026-04-15 — rol_type classificatie (volle_rol / aangebroken / reststuk)
- **Wat:** Migraties 058 + 059. Nieuwe enum `rol_type` + kolom op `rollen`. Helper `bereken_rol_type()` leidt de classificatie af uit artikelnr (laatste 3 cijfers = standaard breedte), breedte_cm, lengte_cm en oorsprong_rol_id. Trigger `rollen_set_rol_type` houdt de kolom automatisch in sync. `voltooi_snijplan_rol()` zet rest-rollen nu op `status='beschikbaar'` i.p.v. `'reststuk'`; drempel verhoogd van 50cm naar 100cm. `rollen_stats()` RPC aggregeert op rol_type. Frontend: `RolRow` en queries/badges gebruiken `rol_type` i.p.v. status-heuristiek.
- **Waarom:** Oude logica telde elke gesneden rest als "reststuk", ongeacht breedte. Werkelijkheid: een reststuk heeft een afwijkende breedte; een aangebroken rol heeft nog standaard breedte maar minder lengte. Classificatie moet fysieke werkelijkheid weerspiegelen, losgekoppeld van workflow-status.
- **Impact:** `rollen.rol_type` kolom (NOT NULL). Bestaande rollen backfilled. Status 'reststuk' blijft bestaan voor legacy data maar wordt niet meer automatisch toegekend bij snijden.

### 2026-04-13 — Confectie-planning gebaseerd op snijplannen
- **Wat:** Migratie 054 herdefinieert view `confectie_planning_overzicht` zodat hij leest uit `snijplanning_overzicht` (status `Gesneden`/`In confectie`) i.p.v. `confectie_orders`. `type_bewerking` wordt afgeleid via `confectie_bewerking_voor_afwerking()`. Confectielijst filtert `Gereed` weg — alleen nog openstaand werk.
- **Waarom:** Lijst en planning gebruikten twee verschillende bronnen waardoor items wel in de lijst stonden maar niet in de planning. Eén bron = één waarheid.
- **Impact:** Migratie 054; `fetchConfectielijst` filtert nu alleen `Gesneden`/`In confectie`.

### 2026-04-13 — Confectie-planning frontend
- **Wat:** Nieuwe `/confectie/planning` route met lanes per afwerkingstype (breedband, feston, locken, enz.). Parallelle lanes, binnen elke lane sequentieel op leverdatum. Werktijden gedeeld met snijplanning (`useWerktijden`, localStorage `karpi.werkagenda.werktijden`). Per-type config (`minuten_per_meter`, `wisseltijd_minuten`, `actief`) inline bewerkbaar via `ConfectieTijdenConfig`. Blokken worden rood gemarkeerd bij eind > leverdatum. Tabs bovenaan Lijst/Planning koppelen naar `/confectie` en `/confectie/planning`.
- **Waarom:** Planner ziet in één oogopslag wanneer welk stuk geconfectioneerd wordt en of het op tijd klaar is voor de leverdatum (spec 10).
- **Impact:** Nieuwe bestanden `lib/supabase/queries/confectie-planning.ts`, `hooks/use-confectie-planning.ts`, `components/confectie/confectie-tijden-config.tsx`, `lane-kolom.tsx`, `confectie-blok-card.tsx`, `pages/confectie/confectie-planning.tsx`. Route toegevoegd in `router.tsx`; `ConfectieTabs` geïntegreerd in `confectie-overview.tsx`.

### 2026-04-13 — Order-bewerking locken op basis van snijstatus
- **Wat:** Orders zijn niet meer onbeperkt bewerkbaar. Drie modi via `computeOrderLock(regels)` in `lib/utils/order-lock.ts`:
  - `none` — nog niets fysiek gesneden → volledige bewerking zoals voorheen.
  - `afwerking-only` — ≥1 maatwerkregel staat op `Gesneden`/`In confectie` en heeft nog geen afwerking → minimalistisch scherm (`AfwerkingOnlyEditor`) waar alleen afwerking (+ bandkleur bij B/SB) per regel gezet kan worden.
  - `full` — alle gesneden regels hebben al afwerking, of alles staat op `Ingepakt`/`Gereed` → order volledig op slot; "Bewerken"-knop grijst uit, directe URL toont amber waarschuwing.
- **Waarom:** Na fysiek snijden kloppen wijzigingen in aantal/prijs/maatvoering niet meer met het stuk. Afwerking wordt vaak pas bij confectie bepaald → die blijft open tot `Ingepakt`.
- **Impact:** Nieuw `order-lock.ts` + `afwerking-only-editor.tsx`, nieuwe mutation `updateRegelAfwerking()` in `order-mutations.ts`, aanpassingen in `order-edit.tsx`, `order-detail.tsx`, `order-header.tsx`.

### 2026-04-13 — Migratie 053: confectie_werktijden tabel + planning-view voor confectie-planning module
- **Wat:** Nieuwe configuratietabel `confectie_werktijden` (PK `type_bewerking`, `minuten_per_meter`, `wisseltijd_minuten`, `actief`, `bijgewerkt_op`) met seed-defaults voor 7 types (breedband, smalband, feston, smalfeston, locken, volume afwerking, stickeren). Trigger-functie `set_bijgewerkt_op()` houdt timestamp bij. Nieuwe view `confectie_planning_overzicht` joint `confectie_orders` → `order_regels` → `orders` → `debiteuren` (+ producten/rollen voor kwaliteit/kleur fallback) en filtert op status 'Wacht op materiaal' / 'In productie'. RLS volgt projectconventie (authenticated full access).
- **Waarom:** Database-fundament voor confectie-planning module (spec 10): planner ziet per afwerkingstype welk stuk wanneer aan de beurt is, met geschatte duur op basis van strekkende meter × minuten/meter + wisseltijd.
- **Noot:** Spec noemde status 'In confectie' maar dat hoort bij `snijplan_status`; voor `confectie_status` is het equivalent 'In productie' — view gebruikt de juiste enum-waarde.

### 2026-04-09 — Fix: overlappende stukken in snijplan visualisatie
- **Wat:** Stukken op de productie-groep pagina werden visueel overlappend getekend terwijl de FFDH-posities correct waren.
- **Oorzaak:** De `snijplanning_overzicht` view miste de `geroteerd` kolom. De frontend moest rotatie raden via shelf-inferentie en koos verkeerd wanneer beide oriëntaties geometrisch pasten. Bijv. stuk 1373 (300×200, geroteerd=true → geplaatst als 200×300) werd getekend als 300×200, waardoor het stuk 1720 (x:200-400) overlapte.
- **Fix:** `geroteerd` kolom toegevoegd aan de view (migratie 048) + `SnijplanRow` type + `mapSnijplannenToStukken` gebruikt nu de vlag direct i.p.v. raden.
- **Impact:** Migratie 048 (DROP+CREATE snijplanning_overzicht), `snijplanning_groepen` view cascade-gedropped (niet actief gebruikt, frontend gebruikt de RPC functie).

### 2026-04-09 — Snijplanning verbeteringen (snijtijden + reststuk flow)
- **Wat:** Drie ontbrekende features uit de oorspronkelijke eisen geïmplementeerd:
  1. **Snijtijden configuratie:** Wisseltijd per rol (default 15 min) en snijtijd per karpet (default 5 min) instelbaar via Productie Instellingen. Geschatte totaaltijd getoond op snijvoorstel-review en productie-groep pagina's.
  2. **Reststuk bevestigingsmodal:** Na het snijden verschijnt een modal waarin de gebruiker de restlengte kan aanpassen of kan kiezen voor "geen reststuk". Pas na bevestiging wordt het reststuk opgeslagen.
  3. **Reststuk sticker printen:** Na bevestiging toont het systeem een reststuk-sticker (rolnummer, kwaliteit, kleur, afmetingen, QR-code, locatieveld) met print-knop.
- **Impact:** Migratie 047 (voltooi_snijplan_rol met p_override_rest_lengte parameter), PlanningConfig uitgebreid met wisseltijd_minuten/snijtijd_minuten, 2 nieuwe componenten (reststuk-bevestiging-modal, reststuk-sticker-layout)

### 2026-04-09 — Fix: dubbele groepen in snijplanning (kleur_code normalisatie)
- **Wat:** Kleur_codes "12" en "12.0" werden als aparte groepen getoond in snijplanning
- **Oorzaak:** Database bevat beide varianten; RPC groepeerde op ruwe kleur_code
- **Fix:** Nieuwe `normaliseer_kleur_code()` SQL helper die ".0" suffix stript. RPC `snijplanning_groepen_gefilterd` groepeert nu op genormaliseerde waarden. Frontend queries gebruiken `getKleurVariants()` om beide varianten op te vragen bij detail- en rollen-queries.
- **Impact:** Migratie 047, frontend queries snijplanning.ts aangepast

### 2026-04-09 — Automatische snijplanning met rolreservering
- **Wat:** Automatische snijplanning die bij nieuwe orders de snijplanning heroptimaliseert en rollen direct reserveert
- **Waarom:** Voorkomt dubbele rolreservering en geeft voorraad-inzicht (gereserveerd vs. vrij). Prioriteit: levertermijn → efficiëntie
- **Hoe:**
  - Nieuwe edge function `auto-plan-groep`: release Gepland stukken → FFDH heroptimalisatie → auto-goedkeuring
  - FFDH algoritme geëxtraheerd naar `_shared/ffdh-packing.ts` (gedeeld door beide edge functions)
  - Globale configuratie via `app_config` (aan/uit + horizon 1-4 weken)
  - "Start productie" knop per rol: beschermt stukken tegen heroptimalisatie
  - Race condition preventie via `snijplan_groep_locks` tabel
- **Impact:** Migratie 046, 2 nieuwe RPCs (`release_gepland_stukken`, `start_productie_rol`), nieuwe edge function, frontend config component

### 2026-04-09 — Snijplanning week-filter
- **Wat:** Leverdatum-filter toegevoegd aan snijplanning overzicht — filtert op week-niveau (deze week, 1-4 weken vooruit)
- **Waarom:** Planning op basis van leverdata — focus op urgente orders ipv heel de backlog
- **Impact:** Nieuwe RPC functies `snijplanning_groepen_gefilterd` en `snijplanning_status_counts_gefilterd`, week-filter component, edge function accepteert `tot_datum`

## 2026-04-09 — Snijplanning productie workflow

### Tab-filtering
- Tabs op snijplanning overview filteren nu daadwerkelijk de groepen
- View `snijplanning_groepen` uitgebreid met per-status counts (incl. `totaal_in_confectie`)
- Naamgeving: `totaal_status_gesneden` (enkel status) vs `totaal_gesneden` (voorbij snijfase)

### Productie-flow
- Nieuwe pagina `/snijplanning/productie/:rolId` voor productie per rol
- Rol-visualisatie met correcte rotatie-inferentie (gedeelde utility)
- "Rol gesneden" knop markeert alle stukken als gesneden via RPC `voltooi_snijplan_rol`
- Sticker preview na het snijden
- "Snijden" shortcut knop in accordion header
- V1 aanname: hele rol wordt in één keer gesneden, geen partial cutting
- Status-transitie V1: Gepland → Gesneden (tussenliggende "In productie" status niet gebruikt)

### Stickers
- Herontwerp met Floorpassion branding en QR-code (synchroon SVG, geen flash)
- QR-codes dienen als tracking door het hele proces (snijden → confectie → inpak)
- Bulk sticker print pagina `/snijplanning/stickers`
- Per regel of bulk (hele groep/rol) printen
- 2 stickers per stuk: tapijt + orderdossier

## 2026-04-09 — Op Maat configuratie-tabellen
- Nieuwe tabel `maatwerk_vormen`: instelbare vormen met toeslag (rechthoek, rond, ovaal, organisch A/B)
- Nieuwe tabel `afwerking_types`: instelbare afwerkingen met prijs (B, FE, LO, ON, SB, SF, VO, ZO)
- Nieuwe tabel `kwaliteit_standaard_afwerking`: standaard afwerking per kwaliteit
- Nieuwe tabel `maatwerk_m2_prijzen`: instelbare m²-prijs per kwaliteit/kleur (geseeded vanuit rollen)
- Extra kolommen op `order_regels`: m²-prijs, kostprijs/m², oppervlak, vorm-toeslag, afwerking-prijs, diameter, kwaliteit_code, kleur_code
- DROP CHECK constraint `order_regels_maatwerk_afwerking_check`, vervangen door FK naar `afwerking_types`
- FK constraint `fk_order_regels_vorm` naar `maatwerk_vormen` (ON DELETE RESTRICT)
- DB-functie `kleuren_voor_kwaliteit()` voor efficiënte kleur+prijs lookup
- RLS policies voor alle 4 nieuwe tabellen

## 2026-04-08 — Productiestatus zichtbaar in order detail

### Frontend
- Gewijzigd: `orders.ts` — `OrderRegelSnijplan` interface + snijplannen ophalen per maatwerk orderregel in `fetchOrderRegels`
- Gewijzigd: `order-regels-table.tsx` — maatwerk regels tonen nu maat, vorm, afwerking en productiestatus badge met link naar snijplanning

## 2026-04-08 — Afwerkingscodes uitbreiden + maatwerk in orderformulier

### Database (migration 038)
- Gewijzigd: `maatwerk_afwerking` CHECK constraint — oude waarden (geen/overlocked/band/blindzoom) vervangen door Karpi-standaard codes: B (Breedband), FE (Feston), LO (Locken), ON (Onafgewerkt), SB (Smalband), SF (Smalfeston), VO (Volume afwerking), ZO (Zonder afwerking)
- Migratie van bestaande data: overlocked→LO, band→B, blindzoom→ZO, geen→NULL

### Frontend
- Gewijzigd: `order-line-editor.tsx` — maatwerk-rij onder orderregel met afwerking, vorm, afmetingen, bandkleur en instructies
- Gewijzigd: `order-mutations.ts` — maatwerk velden meesturen naar create/update RPC
- Gewijzigd: `orders.ts` — maatwerk velden ophalen bij fetchOrderRegels
- Gewijzigd: `order-edit.tsx` — maatwerk velden doorgeven bij bewerken
- Gewijzigd: `article-selector.tsx` — product_type meenemen voor auto-detectie maatwerk
- Gewijzigd: `constants.ts` — AFWERKING_OPTIES en AFWERKING_MAP centraal
- Gewijzigd: `productie.ts` — MaatwerkAfwerking type met nieuwe codes
- Gewijzigd: confectie-tabel, sticker-layout, groep-accordion, week-groep-accordion, snijstukken-tabel — gebruiken nu AFWERKING_MAP

## 2026-04-08 — Snijoptimalisatie: automatische snijplanning

### Database (migration 037)
- Nieuw: `snijvoorstellen` tabel — voorstellen per kwaliteit+kleur met afvalstatistieken
- Nieuw: `snijvoorstel_plaatsingen` tabel — individuele stuk-plaatsingen per rol
- Nieuw: `geroteerd` kolom op `snijplannen` — of stuk 90° gedraaid is
- Nieuw: `keur_snijvoorstel_goed()` functie — atomische goedkeuring met concurrency guards
- Nieuw: `verwerp_snijvoorstel()` functie — verwerp concept-voorstellen
- Nummering: SNIJV prefix voor snijvoorstel nummers

## 2026-04-08 — Frontend snijoptimalisatie review

### Frontend
- Nieuw: `snijvoorstel.ts` query module — Edge Function aanroep, voorstel ophalen, goedkeuren/verwerpen
- Nieuw: `snijvoorstel-review.tsx` pagina — review van gegenereerd snijvoorstel met SVG visualisatie per rol, samenvattingskaart, niet-geplaatste stukken, goedkeuren/verwerpen flow
- Gewijzigd: `groep-accordion.tsx` — "Genereren" knop (Scissors icon) per kwaliteit+kleur groep, roept Edge Function aan en navigeert naar review pagina
- Gewijzigd: `use-snijplanning.ts` — 4 nieuwe hooks: useGenereerSnijvoorstel, useSnijvoorstel, useKeurSnijvoorstelGoed, useVerwerpSnijvoorstel
- Gewijzigd: `productie.ts` types — SnijvoorstelResponse, SnijvoorstelRol, SnijvoorstelPlaatsing, etc. + geroteerd op SnijStuk
- Nieuwe route: `/snijplanning/voorstel/:voorstelId`

## 2026-04-08 — Edge Function snijoptimalisatie (FFDH strip-packing)

### Supabase Edge Function
- Nieuw: `supabase/functions/optimaliseer-snijplan/index.ts`
- FFDH 2D strip-packing algoritme voor optimale plaatsing van snijstukken op rollen
- Input: kwaliteit_code + kleur_code, vindt alle wachtende snijplannen
- Rolselectie: reststukken eerst (kleinste eerst), dan beschikbare rollen (kleinste eerst)
- Stuks worden in twee orientaties geprobeerd, best-fit shelf selectie
- Berekent afvalpercentage (rekening houdend met ronde vormen via pi*r^2)
- Slaat voorstel op in snijvoorstellen + snijvoorstel_plaatsingen tabellen
- Vereist: SNIJV nummeringstype, snijvoorstellen en snijvoorstel_plaatsingen tabellen (nog aan te maken)

## 2026-04-08 — Prijslijsten update april 2026

### Prijslijsten
- Alle bestaande prijslijsten verwijderd (101 stuks) behalve Floorpassion (0145)
- 8 nieuwe Benelux prijslijsten geïmporteerd (210-217), geldig per 01-04-2026:
  - 210: Benelux | 211: Benelux + MV | 212: Benelux + bamboe | 213: Benelux + MV + bamboe
  - 214: Benelux + RM | 215: Benelux + RM + MV | 216: Benelux + RM + bamboe | 217: Benelux + RM + MV + bamboe
- Totaal 15.780 prijsregels geïmporteerd, 52 nieuwe producten automatisch aangemaakt
- Klant-koppelingen bijgewerkt: 0150→0210, 0151→0211 (184 klanten), 0152→0212 (99 klanten), 0153→0213 (239 klanten)
- Nieuw Excel formaat: kolommen A=artikelnr, B=EAN, C=omschrijving, D=omschr.2, E=prijs
- Import script: `import/prijslijst_update_2026.py`

## 2026-04-08 — Automatische maatwerk detectie en snijplan aanmaak

### Database
- Migratie 034: auto-detect maatwerk orders en genereer snijplannen
- Alle order_regels met product_type='rol' worden automatisch gemarkeerd als is_maatwerk=true
- Snijplannen worden automatisch aangemaakt (status 'Wacht') voor alle maatwerk orderregels
- Trigger trg_auto_maatwerk: markeert nieuwe order_regels automatisch als maatwerk bij rol-producten
- Trigger trg_auto_snijplan: maakt automatisch een snijplan aan bij nieuwe maatwerk orderregels
- SNIJ nummeringstype toegevoegd voor snijplan_nr generatie
- snijplanning_overzicht view uitgebreid met sp.rol_id kolom

## 2026-04-08 — Productiemodule maatwerk tapijten

### Database
- Migraties 030-033: maatwerk velden, snijplan uitbreidingen, scan tracking, productie functies en views
- Nieuwe tabellen: scan_events, voorraad_mutaties, app_config
- Nieuwe functies: genereer_scancode(), beste_rol_voor_snijplan(), maak_reststuk()
- Nieuwe views: snijplanning_overzicht, confectie_overzicht, productie_dashboard
- Extended: snijplan_status enum, rollen.status CHECK, order_regels maatwerk kolommen

### Frontend
- Snijplanning module: overzicht per week, gegroepeerd per kwaliteit+kleur, SVG snijvoorstel visualisatie, sticker print
- Confectie module: scan-gestuurd overzicht van afwerkingsstatus
- Scanstation Inpak: tablet-vriendelijk scaninterface voor barcode/QR
- Magazijn: overzicht gereed product met locatiebeheer
- Rollen & Reststukken: gegroepeerd rolbeheer met status badges
- Planning Instellingen: configuratie capaciteit, modus, reststuk verspilling
- Shared: scan-input component, productie types, status kleuren

## 2026-04-03 — Automatische verzendkosten (VERZEND) in orderformulier
- **Frontend:** Nieuw bestand `frontend/src/lib/constants/shipping.ts` met SHIPPING_PRODUCT_ID, SHIPPING_THRESHOLD (€500), SHIPPING_COST (€20)
- **Frontend:** `order-form.tsx` — automatische VERZEND-regel bij subtotaal < €500, verwijderd bij ≥ €500
- **Frontend:** Klanten met `gratis_verzending = true` krijgen nooit verzendkosten
- **Frontend:** Handmatige override: na bewerking/verwijdering van VERZEND-regel stopt de automatische logica
- **Frontend:** Edit mode: bestaande VERZEND-regels worden behouden (override=true)
- **Frontend:** `order-line-editor.tsx` — toont subtotaal en totaal apart wanneer VERZEND-regel aanwezig is
- **Frontend:** `article-selector.tsx` — filtert VERZEND-product uit zoekresultaten
- **Frontend:** `client-selector.tsx` + `order-mutations.ts` — `gratis_verzending` veld toegevoegd aan queries
- **Doel:** Automatische verzendkosten voor kleine orders, met mogelijkheid tot handmatige override

## 2026-04-03 — Product substitutie bij orderregels
- **Database:** `fysiek_artikelnr` en `omstickeren` kolommen op `order_regels` (migratie 025)
- **Database:** `zoek_equivalente_producten()` functie voor equivalentie-lookup via collecties
- **Database:** Reserveringstriggers aangepast: reserveert op `fysiek_artikelnr` (indien gezet)
- **Database:** RPCs `create/update/delete_order_with_lines` bijgewerkt voor substitutie-kolommen (migratie 026)
- **Frontend:** ArticleSelector toont automatisch substitutie-suggesties bij voorraad = 0
- **Frontend:** SubstitutionPicker component voor kiezen van equivalent product
- **Frontend:** Orderregels tonen substitutie-indicator (fysiek artikel + omstickeren badge)
- **Frontend:** fetchOrderRegels laadt substitutie-data voor edit mode
- **Doel:** Klant bestelt product X (factuur), magazijn levert product Y (pakbon) en stickert om

## 2026-04-03 — Klantspecifieke prijslijsten import
- Spec: `specs/09-prijslijst-excel-import.md` — koppeling WeTransfer ZIP (45 Excel prijslijsten) aan klanten
- Python importscript `import/prijslijst_import.py`:
  - ZIP-extractie met filtering van lock-bestanden en macOS metadata
  - Bestandsnaam → prijslijst_nr mapping (regex + zero-padding)
  - Cross-validatie bestandsnaam vs Excel-celwaarde
  - Upsert naar `prijslijst_headers` (nr, naam, geldig_vanaf) en `prijslijst_regels` (artikelnr, prijs, gewicht, etc.)
  - Validatie tegen debiteuren (gekoppelde klanten) en producten (bekende artikelnrs)
  - Configureerbare FK-bescherming (`SKIP_UNKNOWN_ARTIKELNRS`)
  - Gedetailleerd rapport per bestand + totalen

## 2026-04-03 — Klantlogo's import & weergave
- Storage bucket `logos` aangemaakt met publieke leestoegang (migratie 024)
- Python upload script `import/upload_logos.py` met deduplicatie en DB-matching
- Logo zichtbaar op klant-detailpagina met initialen-fallback
- 1.800+ logo's klaar voor upload naar Supabase Storage

## 2026-04-03

### Herclassificatie band-producten
- Band-producten (katoen, leder, leather) zonder karpi_code van "Vaste maat" → "Overig"
- Migratie: `023_herclassificatie_banden_naar_overig.sql`

## 2026-04-02 (update 8)

### Vertegenwoordigers module (nieuw)
- **Overzichtspagina** (`/vertegenwoordigers`): ranking tabel met alle reps
  - Kolommen: ranking, naam, omzet, % van totaal, klanten, tier-verdeling (G/S/B), open orders, gem. orderwaarde
  - Sorteerbaar op omzet, naam, klanten, open orders
  - Periodefilter: YTD, Q1, Q2, Q3, Q4 (berekend uit orders tabel)
  - Inactieve reps visueel gedempt
- **Detailpagina** (`/vertegenwoordigers/:code`):
  - Header met contactgegevens + 4 stat-kaarten (omzet, klanten, open orders, gem. order)
  - CSS mini-bars per maand (omzet trend, proportioneel aan hoogste maand)
  - Tab Klanten: alle gekoppelde klanten met omzet, tier, orders, plaats
  - Tab Orders: alle orders met statusfilter (Alle/Open/Afgerond)
- Nieuwe queries: `fetchVertegOverview`, `fetchVertegDetail`, `fetchVertegMaandomzet`, `fetchVertegKlanten`, `fetchVertegOrders`
- Spec: `specs/08-vertegenwoordigers-module.md`

### Klanteigen namen, artikelnummers en vertegenwoordigers overal zichtbaar
- **Klant-detail pagina** volledig vernieuwd met 5 tabs (conform spec 07):
  - Info (met vertegenwoordiger, route, rayon, factuurgegevens)
  - Afleveradressen
  - Orders
  - Klanteigen namen (kwaliteiten met klant-specifieke benamingen)
  - Artikelnummers (klant-specifieke artikelnummers met product lookup)
- **Order-detail**: orderregels tonen nu klanteigen naam (blauw, onder omschrijving) en klant-artikelnr
- **Order-detail**: vertegenwoordiger fallback naar klant's vertegenwoordiger als order geen eigen code heeft
- **Klant-card**: vertegenwoordiger naam zichtbaar op elke klantkaart
- **Klanten-overzicht**: filter op vertegenwoordiger toegevoegd
- Nieuwe queries: `fetchKlanteigenNamen`, `fetchKlantArtikelnummers`, `fetchVertegenwoordigers`
- `fetchKlantDetail` joint nu vertegenwoordiger naam via relatie
- `fetchOrderRegels` verrijkt regels met klanteigen namen en klant-artikelnummers (batch lookup)

## 2026-04-02 (update 7)

### Automatische voorraadreservering bij orders
- **Migratie 020**: Trigger-gebaseerd reserveringssysteem
  - `herbereken_product_reservering(artikelnr)`: herberekent `gereserveerd` en `vrije_voorraad` voor één product
  - Trigger op `order_regels` (INSERT/UPDATE/DELETE): update productreservering bij elke wijziging
  - Trigger op `orders` (status UPDATE): herbereken bij statuswijziging (bijv. annulering geeft voorraad vrij)
  - Actieve statussen reserveren: Nieuw t/m Klaar voor verzending
  - Eindstatussen geven vrij: Verzonden, Geannuleerd
- **Migratie 021**: Eenmalige sync van bestaande orders naar `producten.gereserveerd`
- Formule: `gereserveerd = SUM(te_leveren)` van alle actieve order_regels per artikelnr
- Formule: `vrije_voorraad = voorraad - gereserveerd - backorder + besteld_inkoop`

## 2026-04-02 (update 6)

### Magazijnlocaties op producten
- **Migratie 019**: `locatie` kolom (TEXT) toegevoegd aan `producten` tabel
- `producten_overzicht` view uitgebreid met locatie
- **Import script** `import_locaties.py`: leest 5.606 locaties uit `Locaties123.xls`, slaat "Maatw." over (302 unieke locaties)
- **Frontend**: locatie als sorteerbare kolom in producten-overzicht
- Inline bewerkbaar: klik op locatie badge om te wijzigen of toe te voegen
- Lege locaties tonen een "Locatie" placeholder bij hover

## 2026-04-02 (update 5)

### Uitwisselbaar-tab op producten overzicht
- **Tab-navigatie** toegevoegd: "Collecties" (bestaande tabel) en "Uitwisselbaar"
- Uitwisselbaar-tab toont alle collecties met 2+ kwaliteiten, gegroepeerd per uitwisselbare groep
- Per kwaliteit worden kleurbadges getoond; gedeelde kleuren (in 2+ kwaliteiten) zijn blauw gemarkeerd met ketting-icoon
- Nieuwe query `fetchUitwisselbareGroepen()` combineert collecties, kwaliteiten en producten-kleuren
- Nieuwe hook `useUitwisselbareGroepen()` met 5 min staleTime
- Nieuw component: `uitwisselbaar-tab.tsx`

## 2026-04-02 (update 4)

### Product type inline bewerkbaar + herclassificatie
- **Type badge** in producten-overzicht is nu klikbaar — opent dropdown om type te wijzigen
- Nieuwe `updateProductType()` query + `useUpdateProductType()` mutation hook
- Na wijziging wordt de productenlijst automatisch ververst
- **Migratie 018**: Herclassificatie van 1407 → 2 "overig" producten:
  - 208 → vast (NNNxNNN >= 1m², ROND patronen)
  - 86 → staaltje (NNNxNNN < 1m², tegels, zitkussens)
  - 175 → rol (BR patroon, ROLLEN, typische rolbreedtes 145-500)
  - 908 MAATWK placeholders gedeactiveerd
  - 17 "NIET GEBRUIKEN" producten gedeactiveerd

## 2026-04-02 (update 3)

### Staaltjes herkenning (product_type)
- **Migratie 017**: producten met vaste afmetingen < 1m² krijgen `product_type = 'staaltje'`
  - Afmeting wordt geparsed uit omschrijving (`CA: NNNxNNN`) — breedte × hoogte < 10.000 cm²
- **Frontend**: nieuw filter tab "Staaltjes", paarse badge "Staaltje"
- **ProductType**: uitgebreid met `'staaltje'` waarde

## 2026-04-02 (update 2)

### Product type onderscheid (vast vs rol)
- Analyse van Karpi_Import.xlsx vs Karpi_Importv2.xlsx: v2 verwijdert 367 MAATWERK placeholders
- **Migratie 015**: `product_type` kolom toegevoegd aan producten (`vast`, `rol`, `overig`)
  - `vast` = vaste afmeting (omschrijving bevat `CA:NNNxNNN`)
  - `rol` = rolproduct, maatwerk (omschrijving bevat `BREED`)
  - `overig` = niet geclassificeerd
  - MAATWERK placeholder producten verwijderd
- **Config**: import wijst nu naar `Karpi_Importv2.xlsx`
- **Import script**: leidt `product_type` af uit omschrijving/karpi_code bij import
- **Frontend producten overzicht**: type filter (Alle/Vaste maten/Rolproducten/Overig) + kleur-badges
- **Frontend product detail**: type badge naast productnaam

## 2026-04-02

### Project opgezet
- Mappenstructuur aangemaakt: brondata/, docs/, specs/, mockups/, supabase/, import/, frontend/
- Bronbestanden verplaatst naar logische mappen
- 1.931 klantlogo's uitgepakt naar brondata/logos/
- CLAUDE.md aangemaakt (centrale referentie, max 100 regels)
- Levende documenten aangemaakt: database-schema.md, architectuur.md, data-woordenboek.md
- 7 requirement specs geschreven (01-07)

### Database
- 10 SQL-migratiebestanden geschreven (001-010)
- 26 tabellen, 6 enums, 5 views, 5 functies, RLS policies, storage bucket
- Nog niet toegepast op Supabase (handmatig via SQL Editor)

### Frontend V1
- React/TypeScript/Vite project opgezet met TailwindCSS v4 + shadcn/ui inspiratie
- Layout: dark sidebar met terracotta accent, topbar met zoekbalk
- Alle 20+ routes aangemaakt (V1 pagina's + placeholders)
- **Orders module**: overzicht (status-tabs, zoeken, paginering) + detail (header, adressen, regels)
- **Klanten module**: overzicht (kaart-grid met logo's, tier badges) + detail (info, adressen, orders)
- **Producten module**: overzicht (tabel met voorraad-indicatoren) + detail (voorraad, rollen)
- **Dashboard**: statistiek-kaarten + recente orders tabel (via Supabase views)
- Supabase queries per module, React Query hooks, formatters (€, datums)
- Alle bestanden <150 regels, netjes opgesplitst per concern
