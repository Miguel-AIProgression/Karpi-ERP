# ADR-0038: Verzend-wachtrij als één tabel gediscrimineerd op `vervoerder_code` (data-as)

**Status:** Geaccepteerd (2026-06-18) — slices 0–4 geïmplementeerd op `refactor/verzend-wachtrij-data-as` (15 karakterisatietests groen, gedragsneutraal); slice 5 (contract-drop) + de cutover wachten op live-bewijs. Plan: [`docs/superpowers/plans/2026-06-18-verzend-wachtrij-data-as.md`](../superpowers/plans/2026-06-18-verzend-wachtrij-data-as.md).

## Context

De verzending kende drie near-identieke wachtrij-tabellen — `hst_transportorders` (mig 171/304), `verhoek_transportorders` (mig 375), `rhenus_transportorders` (mig 380) — elk met dezelfde operationele state-kern (status-enum, `retry_count`, `error_msg`, `is_test`, timestamps, `zending_id`-FK, unique-active-index) en een volledige eigen RPC-set (`enqueue_*` / `claim_volgende_*` / `markeer_*_verstuurd` / `markeer_*_fout` / `herstel_vastgelopen_*`) + monitor-view (`*_verzend_monitor`). De dispatch `enqueue_zending_naar_vervoerder` werd bij élke nieuwe vervoerder volledig herschreven (mig 210 → 375 → 380 → 420 = vier keer dezelfde ~70 regels met één `WHEN`-tak erbij).

De carrier-verschillen waren **puur storage-details**: REST-JSON (HST) vs SFTP-XML (Verhoek/Rhenus), wel/geen track&trace-slot. Conceptueel is er één ding: een wachtrij van zendingen met een state-machine (Wachtrij → Bezig → Verstuurd/Fout) + retry-teller. CONTEXT.md droeg de term **Verzend-wachtrij** al, met de _Avoid_-notitie "per-vervoerder transportorder-tabel als concept" — de data-as was alleen nooit gebouwd.

Dit is de **data-as**, de derde en laatste van de drie vervoerder-seams: de echte carrier-variatie zat al achter de **keuze-as** ([ADR-0008](0008-vervoerder-keuze-als-deep-module.md)/[0030](0030-altijd-een-vervoerder-en-hst-default-carrier.md)), de **capability-as** ([ADR-0034](0034-vervoerder-capability-als-descriptor-registry.md)) en de **process-as** ([ADR-0035](0035-verzend-orchestrator-skeleton-process-as.md)). De data-as was de enige niet-geseamde laag; vóór deze ADR lekte de adapter (ADR-0035) nog per-carrier RPC-namen in de skeleton.

Dit raakt het **live geld-/klantpad** (HST is de enige actieve verzendkoppeling; Rhenus is net live). Een naïeve big-bang zonder vangnet introduceert regressierisico.

## Besluit

1. **Eén tabel `verzend_wachtrij`** (mig 424) gediscrimineerd op `vervoerder_code`, met alléén operationele state: `status` (één enum `verzend_status`), `retry_count`, `error_msg`, `is_test`, timestamps, `zending_id`/`debiteur_nr`, plus drie generieke correlatievelden die de carrier-kolommen subsumeren — `extern_referentie` (HST transportOrderId | SFTP bestandsnaam), `track_trace` (HST trackingNumber | Verhoek zending_nr | NULL Rhenus), `document_pad` (PDF | XML storage-pad). De unieke active-invariant staat op **één** plek (`uk_verzend_wachtrij_zending_actief`), strikter dan de drie losse indexen: één actieve rij per zending over álle carriers.

2. **De zware payload wordt geschrapt**, niet als nullable union opgenomen. `request_payload`/`response_payload`/`response_http_code`/`request_xml` leven al volledig in [`externe_payloads`](../../supabase/migrations/325_externe_payloads_carrier_audit.sql) (mig 324/325 — één rij per poging, in/out, incl. http_code/tracking). De orchestrator (ADR-0035) logt die al voor álle carriers. Dát maakt dit een échte deepening (≈20 artefacten → ≈8), niet een brede nullable-tabel. `error_msg` (operator-leesbaar) blijft op de wachtrij; http_code voor de fout-monitor komt via `externe_payloads` (beslissing A).

3. **Eén generieke RPC-set** geparametriseerd op `vervoerder_code`: `enqueue_transportorder` / `claim_volgende_transportorder` / `markeer_transportorder_verstuurd` / `markeer_transportorder_fout` / `herstel_vastgelopen_verzending`, + één `verzend_monitor`-view (`GROUP BY vervoerder_code`). De dispatch verliest zijn geneste per-code-`CASE`: de api/sftp-takken collapsen tot één `enqueue_transportorder(code)` → een nieuwe api/sftp-vervoerder vereist **nul** dispatch-edits.

4. **De `VerzendAdapter` (ADR-0035) verliest zijn per-carrier RPC-namen.** De orchestrator bezit nu de state-transitie-RPC's (generiek op `vervoerderCode`); de adapter levert alleen nog wat écht per carrier verschilt: `bouwPayload`/`transport` (render + protocol), `bewaarArtefact` (PDF vs XML → `document_pad`), `uitkomst` (→ `extern_referentie`/`track_trace`) en de `noteer*`-summary-cosmetica. Dit sluit de trilogie.

5. **Gedragsbehoud, expliciet:** `markeer_transportorder_verstuurd` zet `zendingen.track_trace` alleen bij een non-NULL `p_track_trace` (Rhenus → NULL → geen T&T, exact als voorheen); de status-flip Klaar voor verzending → Onderweg gebeurt voor álle carriers. De retry-cascade in `markeer_transportorder_fout` is ongewijzigd. De mig-304-spiegel naar `order_documenten` (HST-vrachtbrief in DocumentenCompact) is overgenomen op `verzend_wachtrij`, gegate op `vervoerder_code='hst_api'`.

6. **Vangnet + veilige cutover.** De 15 karakterisatietests (`*-send/verwerk-row.test.ts` + de fake-supabase-recorder) bleven groen op de generieke RPC-namen = gedragsneutraal. Deploy is **drain + crons gepauzeerd in één atomisch venster** (mig 424 + 3 edge functions + frontend samen); de oude tabellen + RPC's blijven staan als rollback-vangnet en worden pas in een aparte contract-migratie (slice 5) gedropt ná ≥1 echt bewezen HST- én Rhenus-zending via `verzend_wachtrij`. (Beslissing B — geen RPC-shims: een per-carrier-shim kan de oude rowtype niet reproduceren nadat de payload-kolommen weg zijn.)

## Bewust buiten scope

- **Keuze-as** (`vervoerder_selectie_regels`, resolver) — al data-driven (ADR-0008/0030), ongemoeid.
- **Capability-as** (`_shared/vervoerders/capabilities.ts`) — al geland (ADR-0034); blijft de bron voor preflight/landbereik/defaults.
- **Format-builders + transport** (`bouwTransportOrderPayload`/`bouwVerhoekXml`/`bouwRhenusXml`, REST vs SFTP) — echte protocolverschillen, by-design; de adapter omhult ze.
- **EDI-carriers** (Transus) — eigen `edi_berichten`-audit/queue, geen transportorder-tabel.

## Consequenties

- Een vierde vervoerder = één capability-rij (ADR-0034) + één format-builder + één afgeslankte `VerzendAdapter` + dunne `index.ts`-wrapper + een selectie-regel. **Geen** DDL-kopie, **geen** dispatch-edit, **geen** nieuwe monitor-view.
- Retry-logica, een nieuwe status of een index wijzig je op één plek i.p.v. drie tabellen/enums.
- `response_http_code` is niet meer in de fout-monitor-tabel zichtbaar; de operator ziet `error_msg` + `retry_count` (de actionable reden) en de volledige http_code/response in de payload-audit (`externe_payloads`; diagnose-UI staat op de backlog).
- **Deploy-fan-out:** mig 424 + `hst-send`/`verhoek-send`/`rhenus-send` + frontend horen in één cutover-venster (zie het draaiboek-deel van het plan). De oude artefacten dropt slice 5 ná live-bewijs.
