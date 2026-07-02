# Logistiek & verzending

> Module-doc: huidige staat + valkuilen. Chronologie: [docs/changelog.md](../changelog.md). Actuele RPC-bodies/tabellen: schema-snapshot / `supabase/migrations/`.

## Wat dit is

Alles vanaf "Pickronde gestart" tot "pakket bij de klant": zendingen bundelen op
afleveradres, colli aanmaken (SSCC, afmetingen, gewicht, omschrijving),
verzendlabels/pakbon/picklijst printen, en de daadwerkelijke aanmelding bij een
vervoerder (HST/Verhoek/Rhenus/eigen vervoer/afhalen). Grenst aan
[Pick & Ship / Startbaarheid](../adr/0037-pickbaarheid-startbaarheid-als-deep-module.md)
(vóór de pickronde) en aan Facturatie (het Factuurdocument/Pakbondocument
delen renderers, zie `CONTEXT.md`).

## Kernbestanden

| Laag | Pad | Rol |
|---|---|---|
| Frontend lib | `frontend/src/modules/logistiek/lib/printset.ts` | `bouwVerzenddocument`/`expandLabels`/`bouwPicklijst` — colli-expansie voor label, pakbon, picklijst |
| Frontend lib | `frontend/src/modules/logistiek/lib/startbaarheid.ts` | Startbaarheid-predikaat (ADR-0037) — grenst aan dit domein via `geen_vervoerder` |
| Frontend lib | `frontend/src/modules/logistiek/lib/handmatig-aanmelden.ts` | `isHandmatigAanmeldenVervoerder`/`ondersteuntColliBundelen`/`bundelOpPallet`/`palletTypeOpties` |
| Frontend lib | `frontend/src/modules/logistiek/lib/shipping-label-data.ts` | Labeltekst: productnamen, maat, leverancierskleurcode |
| Frontend lib | `frontend/src/modules/logistiek/lib/hst-depot.ts` | Postcode→HST-depot-lookup voor het label |
| Frontend lib | `frontend/src/lib/logistiek/labelbarcode.ts` | Re-export-shim van de Labelbarcode-seam (ADR-0033) |
| Frontend lib | `frontend/src/lib/orders/vervoerder-eisen.ts` | Re-export-shim van de preflight-validator |
| Frontend lib | `frontend/src/lib/orders/dropshipment-regel.ts`, `dropship-email.ts` | Dropshipment-detectie + e-mail-guard |
| Frontend registry | `frontend/src/modules/logistiek/registry.ts` | UI-mapping vervoerder-code → naam/badge (géén gedrag) |
| Frontend componenten | `frontend/src/modules/logistiek/components/pakbon-document.tsx`, `picklijst-document.tsx`, `shipping-label.tsx`, `colli-bundel-dialog.tsx`, `colli-bundel-sectie.tsx`, `hst-monitor-panel.tsx`, `hst-aandacht-banner.tsx` | Print-/monitor-UI |
| Edge function | `supabase/functions/hst-send/` (`index.ts`, `payload-builder.ts`, `hst-client.ts`) | HST REST-adapter |
| Edge function | `supabase/functions/verhoek-send/` | Verhoek SFTP/AA2.0-XML-adapter |
| Edge function | `supabase/functions/rhenus-send/` (`xml-builder.ts`) | Rhenus SFTP/GS1-XML-adapter |
| Shared (edge+deel) | `supabase/functions/_shared/verzend-orchestrator.ts` | Process-as: gedeeld per-rij-skelet (ADR-0035) |
| Shared | `supabase/functions/_shared/vervoerders/capabilities.ts` | Capability-registry (ADR-0034) |
| Shared | `supabase/functions/_shared/vervoerders/labelbarcode.ts` | Labelbarcode-encoding (AI(00)+SSCC) |
| Shared | `supabase/functions/_shared/vervoerders/fetch-zending-colli.ts` | Zending-colli-seam — enige colli-query voor alle adapters |
| Shared | `supabase/functions/_shared/vervoerders/colli.ts` | Per-colli preflight-validatie |
| Shared | `supabase/functions/_shared/vervoerder-eisen.ts` | Adres/telefoon/land-preflight (`valideerVoorVervoerder`) |
| Shared | `supabase/functions/_shared/adres-split.ts` | `splitAdres`/`normalizeCountry`/`landNaarIso2Strikt` |
| Shared | `supabase/functions/_shared/kwaliteit-naam.ts` | `leverancierskleurcodeUitVervolg` (+ `kwaliteitNaamUitVervolg`) |
| Shared | `supabase/functions/_shared/pakbon/` (`pakbon-document.ts`, `aggregatie.ts`, `pakbon-pdf.ts`, `fetch.ts`) | Pakbondocument-seam (server-PDF + gedeelde regel-aggregatie) |
| Kern-tabellen | `zendingen`, `zending_orders`, `zending_regels`, `zending_colli`, `verzend_wachtrij`, `vervoerders`, `vervoerder_selectie_regels` | Bron-van-waarheid |
| Kern-views | `voorgestelde_zending_bundels`, `hst_verzend_monitor`/`verzend_monitor`, `orders_zonder_vervoerder` | Preview/monitoring |
| Kern-RPC's | `start_pickronden`, `genereer_zending_colli`, `enqueue_zending_naar_vervoerder`, `enqueue_transportorder`, `markeer_transportorder_verstuurd/_fout`, `markeer_transport_bevestigd`, `maak_colli_bundel`/`verwijder_colli_bundel`, `herstel_vastgelopen_verzending` | Zending- en verzend-lifecycle |

## Geldende ADR's & specs

- [ADR-0008](../adr/0008-vervoerder-keuze-als-deep-module.md) — vervoerder-**keuze**-as: `override → regel → geen`-resolver, geen klant-fallback meer.
- [ADR-0012](../adr/0012-bundel-zending-als-deep-module.md) — Bundel-Zending als deep module, 4D-sleutel canoniek, `zending_orders` = de M2M-bron.
- [ADR-0030](../adr/0030-altijd-een-vervoerder-en-hst-default-carrier.md) — altijd-een-vervoerder (HST NL/BE-catch-all) + observability.
- [ADR-0031](../adr/0031-verhoek-xml-sftp-adapter.md) — Verhoek = eigen AA2.0-XML/SFTP, geen Transus-EDI.
- [ADR-0032](../adr/0032-rhenus-gs1-xml-sftp-adapter.md) — Rhenus = GS1 TransportInstruction-XML/SFTP, geen Transus-EDI.
- [ADR-0033](../adr/0033-gedeelde-logica-cross-root-import-niet-kopieren.md) — pure logica leeft éénmaal in `_shared/`, frontend importeert via shim, nooit kopiëren.
- [ADR-0034](../adr/0034-vervoerder-capability-als-descriptor-registry.md) — capability-**as**: landbereik/preflight/defaults/protocol per vervoerder in één registry.
- [ADR-0035](../adr/0035-verzend-orchestrator-skeleton-process-as.md) — process-**as**: gedeeld per-rij-skelet, adapter levert alleen render+transport.
- [ADR-0038](../adr/0038-verzend-wachtrij-als-data-as.md) — data-**as**: één `verzend_wachtrij`-tabel i.p.v. drie per-carrier tabellen (LIVE, oude tabellen gedropt in mig 427).
- Plans: [2026-06-13-vervoerder-capability-seam.md](../superpowers/plans/2026-06-13-vervoerder-capability-seam.md), [2026-06-14-verzenddocument-een-bron.md](../superpowers/plans/2026-06-14-verzenddocument-een-bron.md), [2026-06-18-verzend-wachtrij-data-as.md](../superpowers/plans/2026-06-18-verzend-wachtrij-data-as.md), [2026-06-17-rhenus-colli-bundeling-design.md](../superpowers/specs/2026-06-17-rhenus-colli-bundeling-design.md), [2026-06-13-sscc-analogen-audit.md](../superpowers/plans/2026-06-13-sscc-analogen-audit.md), [2026-06-14-colli-afmetingen-snapshot-handoff.md](../superpowers/plans/2026-06-14-colli-afmetingen-snapshot-handoff.md) (ADR-0035's eigen implementatieplan is niet als los bestand teruggevonden; het ADR zelf draagt de sequence).
- `CONTEXT.md`-termen (niet dupliceren, ⟶ opzoeken): **Labelbarcode**, **Verzendlabel**, **Zending-colli**, **Verzend-wachtrij**, **Pakbondocument**, **Artikelpresentatie**, **Manco**/**Manco-resolutie**, **Pickbaarheid**, **Startbaarheid**, **Combi-levering**.

## Bedrijfsregels (huidige staat)

### Zending-bundeling op afleveradres (ADR-0012, mig 222/228-230)
- Orders met identiek genormaliseerd afleveradres (`_normaliseer_afleveradres`) + dezelfde effectieve vervoerder + dezelfde debiteur bundelen bij pickronde-start automatisch in 1 zending → 1 pakbon → 1 transportorder. Bron-van-waarheid voor "orders in een zending": M2M-tabel `zending_orders`.
- Bundel-sleutel is **4-dimensionaal**: `(debiteur × adres-norm × effectieve vervoerder × verzendweek)`. Single source: SQL `bundel_sleutel()`/`verzendweek_voor_datum()` ↔ TS-spiegel [`bundel-sleutel.ts`](../../frontend/src/lib/orders/bundel-sleutel.ts). SQL↔TS-contract via golden fixtures (mig 385) — wie de normalisatie/sleutel wijzigt, moet golden + een nieuwe contract-migratie meesturen (het contract-mechanisme zelf, incl. `_normaliseer_afleveradres`, hoort bij het orders-domein, niet hier).
- Live preview vóór pickronde-start: view `voorgestelde_zending_bundels` (puur SQL, geen state). Pick & Ship clustert ook op de 4D-sleutel (niet op debiteur) zodat verschillende vervoerders binnen dezelfde klant losse cards krijgen.
- `trg_lock_zending_bundel_sleutel` (mig 230) blokkeert mutatie van afleverdatum/afl_*/debiteur op orders in een actieve bundel-zending (`Klaar voor verzending`+).
- `voltooi_pickronde` is bundel-aware: flipt élke betrokken order naar Verzonden zodra de laatste open zending van de bundel klaar is.

### Vervoerder-keuze, altijd-een-vervoerder & observability (ADR-0008/0030)
- Ladder `override (orderregel) → regel (`vervoerder_selectie_regels`, geëvalueerd op prioriteit) → geen`. HST is de default-catch-all binnen NL+BE (laagste prio 99999, `hst_api.actief=TRUE` gate't de INSERT); Rhenus is de DE-catch-all (prio 99998). Specifieke regels (lagere prio) winnen altijd.
- Pre-flight-poort `valideerVoorVervoerder(ctx)` (`_shared/vervoerder-eisen.ts`) is de laatste check vóór elke POST/upload — faalt een eis (telefoon/adresveld/land-buiten-bereik) → rij direct op `Fout`, geen kansloze verzendpoging.
- Self-healing reaper `herstel_vastgelopen_verzending` (generiek sinds ADR-0038, was per-carrier `herstel_vastgelopen_hst/verhoek/rhenus`) zet rijen die > N minuten op 'Bezig' hangen terug naar 'Wachtrij'.
- Monitor: `hst_verzend_monitor`/generieke `verzend_monitor` (`GROUP BY vervoerder_code`) — `oudste_wachtrij_minuten` is het cron-health-signaal (UI-drempel 5 min). View `orders_zonder_vervoerder` voedt de "Geen vervoerder mogelijk"-teller, met land-uitsplitsing en `alleen_productie`-orders uitgesloten (ADR-0029, Basta-verzending).
- Payload-standaard HST: tapijtrollen als `PackageUnitID='col'` (kleine letters), `Length=min(lengte,breedte)`, vaste `Width=Height=30` bij rollen-fallback; `ShippingServices=[]` (géén "bellen voor aflevering"). `ToAddress`/`FromAddress.City` in hoofdletters.

### Verzendlabel, Labelbarcode & leverancierskleurcode
- Eén canoniek `ShippingLabel`-component (CONTEXT.md: **Verzendlabel**) voor alle vervoerders; enige per-vervoerder verschil is de HST-depotregel (`hst-depot.ts`, postcode→depot).
- Labelbarcode (CONTEXT.md-term) = AI(00)+SSCC, één encoding-functie `labelBarcode()` (`_shared/vervoerders/labelbarcode.ts`); alle zes consumenten (3 labelvarianten-legacy zijn samengevoegd tot 1, HST `BarCode`, Verhoek `ScanCode`, Rhenus `<sscc>`) lezen díé. SSCC-waarde zelf blijft `zending_colli.sscc` (DB-sequence `genereer_sscc()`); géén client-side SSCC-generatie meer. Zending zonder colli-rijen → label zonder barcode (nooit een niet-aangemelde barcode printen).
- Leveranciers-kleurcode (2026-07-01): bij 18 kwaliteiten (ANNY, ARIA, CABA, DIAN, DREM, FAYN, ITEA, JEAS, LINE, MAND, MARG, MELW, OKSI, OPHE, ROMY, SOFI, WASI, WELL) wijkt de leverancier-sticker-kleurcode af van Karpi's `kleur_code`. Herkenning: pure helper `leverancierskleurcodeUitVervolg` (`_shared/kwaliteit-naam.ts`) parset `producten.vervolgomschrijving` op patroon `{3-6 cijfers}-{2-6 alfanumeriek}`; getoond op het label als "SOFIA (13 – G305) 80x150 cm". Puur tekst-parsing, geen migratie.

### Zending-colli: snapshot, afmetingen, gewicht, bundeling
- Zending-colli (CONTEXT.md-term) = de bevroren per-pakket-snapshot (`zending_colli`), aangemaakt door `genereer_zending_colli` bij pickronde-start: `sscc`, `omschrijving_snapshot`/`klant_omschrijving_snapshot`, `lengte_cm`/`breedte_cm` (`COALESCE(order_regels.maatwerk_*, producten.*)`, gejoind via `order_regels.artikelnr` — **niet** `zending_regels.artikelnr`, dat wordt nooit gevuld door `start_pickronden`), `klanteigen_naam_snapshot`, `omsticker_snapshot` (fysiek gepakte equivalent-code bij omstickeren). Ophalen loopt uitsluitend via de seam `fetchZendingColli` (`_shared/vervoerders/fetch-zending-colli.ts`) — geen adapter herleidt dit zelf uit een live product-join.
- Gewicht: bron-van-waarheid `kwaliteiten.gewicht_per_m2_kg`; `producten.gewicht_kg` is een afgedwongen gederiveerde cache (trigger `trg_producten_gewicht_derive`, vast/staaltje-producten). `genereer_zending_colli` vult colli-gewicht via ladder `regel → resolver → product`, verplicht > 0 voor Rhenus/Verhoek-preflight. `zendingen.totaal_gewicht_kg` wordt door `trg_sync_zending_totaal_gewicht` gelijk gehouden aan `SUM(zending_colli.gewicht_kg)`.
- Colli-bundeling: een collo-rij met `is_bundel=TRUE` (`bundel_colli_id` op de kind-colli's) telt als 1 collo in élk carrier-bericht en op elk label/pakbon — één filter-predicaat `bundel_colli_id IS NULL` in zowel de colli-seam als `bouwVerzenddocument`.
  - **Rhenus:** handmatig bundelen tijdens 'Picken' óf ná voltooien (dagbatch); `pallet_type ∈ {NULL(zak/RLEN), 'PLTS'(volle pallet), 'HPLT'(halve pallet)}`. Footprint is server-side default bij PLTS/HPLT (PLTS 80×120, HPLT 80×60 — **HPLT-footprint is een aanname, nog te bevestigen door Rhenus**) maar editbaar in de UI; `hoogte_cm` (laadhoogte) optioneel, alléén bij een echte pallet (**`<height>`-veld staat niet in het legacy-referentiebestand, te bevestigen bij Rhenus**). Rhenus-zendingen worden na voltooien automatisch ge-enqueued maar pas claimbaar op de eerstvolgende werkdag-16:00 (`verzend_wachtrij`-analoog `beschikbaar_op` ← `volgende_batch_moment()`, `vervoerders.batch_cutoff_tijd`) — géén hold meer op 'Klaar voor verzending'. `meld_zending_handmatig_aan`/"Nu aanmelden" vervroegt dit als escape-hatch.
  - **HST:** pallet-bundeling tijdens 'Picken' (géén dagbatch — HST meldt direct aan na 'Voltooi pickronde'); `pallet_type ∈ {'EP'(Europallet),'SP'(wegwerp),'MP'(mini),'PLH'(halve pallet)}`; footprint = MAX van de kind-colli (geen vaste default, HST prijst op `PackageUnitID`).
  - Frontend-splitsing: `ondersteuntColliBundelen` (Rhenus+HST, bundel-knop tijdens 'Picken') vs. `isHandmatigAanmeldenVervoerder` (Rhenus-only, 16:00-copy/navigatie) vs. `bundelOpPallet`/`palletTypeOpties(code)` (welk vervoerderstype welke pallet-opties toont) — allen in `handmatig-aanmelden.ts`.

### Verzenddocument & Pakbondocument — één colli-expansie, dunne renderers
- `bouwVerzenddocument(zending)` (`printset.ts`) expandeert een zending éénmaal naar `colliRijen` (1 per fysieke collo, voor alle labelvarianten) én `pakbonRegels` (1 per orderregel, geaggregeerd). Beide uit dezelfde colli→regel-map/snapshot-lookup/VERZEND-filter — géén losse per-document-afleiding meer.
- De pakbon zelf is sinds 2026-06-19 verder geconsolideerd tot het CONTEXT.md-concept **Pakbondocument**: `_shared/pakbon/` (`bouwPakbonDocument`/`aggregatie.ts`) is de ene seam die zowel de geprinte React-pakbon (`pakbon-document.tsx`, deelt de aggregatie cross-root) als de server-PDF (`pakbon-pdf.ts`, factuurmail-bijlage) voedt — beide zijn dunne renderers, geen twee onafhankelijke JSX/PDF-afleidingen meer. Routecode (HST-depot) is print-only render-context, geen documentveld.
- Picklijst (2026-07-02): pure aggregatie `bouwPicklijst(zendingen)` in dezelfde `printset.ts`, hergebruikt `expandLabels`/`totaal_gewicht_kg` — géén nieuwe query. Eén A4-rij per zending (bundel-zending = 1 rij), derde dunne renderer in pakbon-stijl (`picklijst-document.tsx`). Puur frontend, geen migratie/edge-functie-wijziging.

### Verzend-orchestrator (process-as, ADR-0035) + Verzend-wachtrij (data-as, ADR-0038)
- Eén gedeeld skelet `verwerkVerzendRij` (`_shared/verzend-orchestrator.ts`) draagt de volledige rij-sequence voor HST/Verhoek/Rhenus: fetch zending/order/bedrijfsgegevens → colli via de Zending-colli-seam → 0-colli-guard (`hardFailOnZeroColli`, HST/Verhoek hard, Rhenus via preflight) → capability-preflight → bestandsnaam (SFTP-dedup, gepersisteerd vóór upload) → `bouwPayload`/`transport` (carrier-specifiek, via `VerzendAdapter`) → **idempotentie-anker** → audit (`log_externe_payload`) → markeer succes/fout.
- **Idempotentie-anker** (`markeer_transport_bevestigd`, direct ná een geslaagde transport-call, vóór de faalbare audit/artefact-stappen): voorkomt dat een crash/timeout ná een geslaagde POST de reaper laat denken dat de rij vastliep, waardoor hij 'm zou recyclen en de carrier (HST = POST-only, geen idempotentie) de zending dubbel aanmaakt. Bij een TERMINALE fout (carrier maakte server-side al aan ondanks `Success=false`) wordt hetzelfde anker gezet + de rij gaat met `p_max_retries=1` direct naar Fout — een retry zou een duplicaat geven.
- Data-as: alle drie carriers delen één tabel `verzend_wachtrij` (gediscrimineerd op `vervoerder_code`) + één generieke RPC-set (`enqueue_transportorder`/`claim_volgende_transportorder`/`markeer_transportorder_verstuurd`/`_fout`/`herstel_vastgelopen_verzending`). De oude per-carrier tabellen (`hst_transportorders`/`verhoek_transportorders`/`rhenus_transportorders`) zijn **definitief gedropt** (mig 427) — verwijs er niet meer naar als levend concept. Zware request/response-payload leeft niet meer op de wachtrij maar in `externe_payloads` (audit, in+out).
- Vierde vervoerder toevoegen = één capability-rij (ADR-0034) + één format-builder + één `VerzendAdapter` + dunne `index.ts`-wrapper + een selectie-regel — géén DDL-kopie, géén dispatch-edit, géén nieuwe monitor-view.

### Verhoek & Rhenus — SFTP-adapters (ADR-0031/0032)
- **Verhoek**: eigen XML-formaat "XMLstandardVerhoekEuropeAA20", géén Transus-EDI. Colli-preflight eist `sscc`+`lengte_cm`+`breedte_cm`+`gewicht_kg` (géén defaults toegestaan). Bestandsnaam `Karpi_<timestamp>_<zending_nr>.xml` = Verhoek-dedup-sleutel, gepersisteerd vóór upload. `verhoek_sftp.actief=FALSE` tot de rondreis-test geslaagd is (open item, zie Openstaand).
- **Rhenus**: GS1 "RHE" 3.1-XML met SBDH-header, **kg met decimalen** (géén decagram, in tegenstelling tot Verhoek), adres als één regel (geen `splitAdres`), géén T&T-slot. `≥1 colli` is een harde preflight-eis (incident 0455395 — Rhenus' mapping verplicht een item-segment). `package_type_code` default `'RLEN'` (los/rol), `'PLTS'`/`'HPLT'` bij een pallet-bundel (zie Colli-bundeling hierboven) — dan stuurt `bouwItem` ook een `<width>`-dimensie i.p.v. alleen `<depth>`.
- Beide gebruiken de gegeneraliseerde `_shared/sftp-client.ts`; de orchestrator-loop zelf is bewust twee keer gespiegeld (generalisatie = backlog, zie ADR-0035 "bewust buiten scope").

### Gewicht-keten
- Bron-van-waarheid: `kwaliteiten.gewicht_per_m2_kg`. `producten.gewicht_kg` is een **afgedwongen** gederiveerde cache (BEFORE-trigger `trg_producten_gewicht_derive`) — vast/staaltje-producten met maat+density worden bij elke INSERT/UPDATE herleid, vorm-aware. Handmatig `gewicht_kg` zetten kan dus niet; corrigeer de density.
- `bereken_orderregel_gewicht_kg` rekent vast-producten live (geen cache-copy). Colligewicht-ladder in `genereer_zending_colli`: `NULLIF(regel,0) → resolver → NULLIF(product,0)`.
- **Residu (nog open):** broadloom/rol-producten zonder stuk-maten hebben géén berekenbaar gewicht (de trigger dekt alleen vast/staaltje) → vóór een Rhenus/Verhoek-zending met zo'n product moet `gewicht_kg` handmatig gezet worden. Check-script: `import/check_gewicht_integriteit.py`.

### Dropshipment
- Herkenning: `producten.is_dropship` (data-driven, ADR-0018-patroon — nieuw dropship-artikel = `UPDATE producten`, geen code-edit). TS: `isDropshipRegel`/`heeftDropshipRegel` (dual-shape, [`dropshipment-regel.ts`](../../frontend/src/lib/orders/dropshipment-regel.ts)); `detecteerDropshipKeuze` is artikelnr-based en voedt **uitsluitend** de selector-toggle-UI, niet de detectie.
- Prijs is data-driven uit `producten.verkoopprijs` (`useDropshipPrijzen`) — geen hardcoded TS-bedragen meer; de selector blokkeert 'klein'/'groot' tot de prijs geladen is.
- Een dropship-kostenregel ís de verzendcomponent: `applyShippingLogic` verwijdert/weigert een VERZEND-regel zodra `heeftDropshipRegel(regels)` is (alle call-sites: klantwissel, regel-mutaties).
- Géén fysiek collo: dropship-kostenregels zijn admin-pseudo (`is_pseudo=TRUE`) en worden generiek geweerd uit `zending_regels` door trigger `trg_zending_regels_skip_admin_pseudo` (`NOT is_admin_pseudo()`, dekt alle insert-paden — VERZEND/DROPSHIP-*/kortingsregels).
- `afl_email` bij dropship = het **consumenten**-adres (T&T-doel), wijkt per definitie af van debiteur-/factuur-e-mail — orderformulier blokkeert opslaan bij gelijk-aan; `fn_zending_fill_email` kopieert bij dropship géén factuur-/debiteur-adres naar `zendingen.afl_email` (liever geen T&T dan T&T naar de winkel).

### Eigen vervoer & afhalen
- "Eigen vervoer" (`type='eigen'`, vervoerder-code `eigen_vervoer` in de registry) betekent **niet** afhalen — Karpi bezorgt zelf met de eigen bus en rekent daarvoor **wél** bezorgkosten. `set_orderregel_vervoerder_override_voor_order` raakt de VERZEND-regel niet meer aan, ongeacht welke vervoerder gekozen is.
- "Afhalen" (order-niveau `afhalen`, géén vervoerder) is het enige geval waar `applyShippingLogic` de VERZEND-regel wél verwijdert — de klant haalt zelf op.
- `eigen_vervoer` heeft geen externe koppeling: alleen colli/label/pakbon, geen `verzend_wachtrij`-rij, geen capability-descriptor.

### Vervoerder-capability-seam (ADR-0034)
- De *keuze*-as (welke vervoerder) en de *capability*-as (wat een vervoerder eist/kan) zijn losgekoppeld. Eén pure registry `VERZEND_CAPABILITIES`/`capabilityVoor(code)` (`_shared/vervoerders/capabilities.ts`) draagt per vervoerder: `protocol` (rest/sftp), `landbereik`, `preflight`-eisen (telefoon/land-in-bereik/adresvelden/colli-verplicht/colli-velden), `defaultAfmetingen` (alleen HST, tapijtrollen zonder gemeten maat), `maxPerRun`.
- Consumers lezen de descriptor i.p.v. eigen `if code === ...`-takken: `valideerVoorVervoerder`, `valideerColli` (`_shared/vervoerders/colli.ts`), de HST `payload-builder.ts`-defaults, de drie `MAX_PER_RUN`-limieten.
- Pure registry (géén DB) zodat de frontend 'm via de shim deelt (ADR-0033). De `vervoerders`-tabel blijft de administratieve bron (`actief`/`display_naam`/FK).

## Valkuilen & gotcha's

- **Niet te verwarren: `zending_orders` vs. de 4D-bundel-sleutel.** `zending_orders` is de fysieke M2M-koppeling (welke orders zitten in déze zending); de 4D-sleutel (`bundel_sleutel()`) is de *identiteit* die bepaalt of orders **automatisch** in dezelfde zending horen. Combi-levering (ander domein) gebruikt een 2D-sleutel (`debiteur × adres-norm`, géén vervoerder/week) voor een heel andere beslissing (wachten vs. bundelen) — niet verwarren met de Bundel-Zending-sleutel.
- **Niet te verwarren: `vervoerders.type` ('api'/'edi') is mislabeld** — Verhoek/Rhenus zijn SFTP, geen EDI. De capability-registry's `protocol`-veld (`'rest'|'sftp'`) is de correcte bron; `vervoerders.type` blijft staan voor UI/FK-doeleinden maar niet als gedrags-bron.
- **Niet te verwarren: EDI-carriers (Transus) horen niet in dit domein.** Transus draait op `edi_berichten` (eigen rijke audit/queue), géén `verzend_wachtrij`-rij, géén `VerzendAdapter`. Verhoek/Rhenus zaaiden ooit als `edi_partner_a/b` (mig 170) maar zijn expliciet **geen** EDI-carriers (ADR-0031/0032) — puur SFTP-XML.
- **Niet te verwarren: `externe_payloads` (audit, in+én-uit, best-effort, mag verzending nooit blokkeren) vs. `verzend_wachtrij` (operationele state-machine, wél blokkerend/retrybaar).** Elke retry = een nieuwe `externe_payloads`-rij, dus de volledige poging-historie blijft bewaard — anders dan de wachtrij die per rij overschrijft.
- **Bewust niet gebouwd: cross-carrier orchestrator-loop-generalisatie.** De claim-loop + reaper + secret/dry-run-resolutie blijven per carrier in elke `index.ts` (env-resolutie is carrier-specifiek) — alleen de per-rij-verwerking is gedeeld (ADR-0035, expliciet "bewust buiten scope").
- **Bewust niet gebouwd: statusterugkoppeling (T&T) voor Rhenus.** Rhenus' `/out`-map-verwerking is V2-backlog; `track_trace` blijft NULL voor Rhenus-zendingen.
- **Bewust niet gebouwd: HST lange-colli-pakkettypes** (col/BDLS/LNGT i.p.v. de huidige clamp) — branch bestaat, is niet gedeployed; blocker is dat HST die pakkettypes nog moet openzetten aan hun kant.
- **Bewust niet aangeraakt: format-builders/protocol zelf (HST-JSON vs. SFTP-XML)** — echte protocolverschillen, by-design buiten alle drie de seams (ADR-0034/0035/0038).
- **Deploy-volgorde: mig 426 (verzend_wachtrij) + de 3 `*-send`-edge-functions + frontend horen in één cutover-venster.** Tussen een DB-only en een function-only deploy zou de oude/nieuwe tabel-aanname mismatchen. Mig 427 (drop van de oude tabellen) mag pas ná ≥1 bewezen HST- én Rhenus-zending via `verzend_wachtrij` — dat bewijs is inmiddels geleverd, mig 427 is uitgevoerd.
- **Deploy-volgorde: mig 399/400 (colli-afmetingen-snapshot) vóór een Rhenus/Verhoek-go-live-canary** — join via `order_regels.artikelnr`, níet `zending_regels.artikelnr` (die laatste wordt nooit gevuld door `start_pickronden`); een verkeerde join laat `lengte_cm`/`omschrijving_snapshot` leeg voor vaste producten en blokkeert de hele DE-instroom op de Rhenus-preflight.
- **Niet te verwarren: de Pakbondocument-renderer heeft een tweede, slapende consument.** Op een onafgemaakte branch bestaat een aparte verzendbevestiging-mail (pakbon naar het afleveradres) die dezelfde `_shared/pakbon/`-renderer hergebruikt — wie de renderer wijzigt raakt dus ook die dormante feature, niet alleen de geprinte pakbon en de pakbonmail.
- **Deploy-volgorde-precedent RPC-signatuur-uitbreidingen (mig 490):** `maak_colli_bundel` ging van 6 naar 7 args (`p_hoogte_cm`) via DROP+CREATE met DEFAULT NULL — de migratie moet vóór de frontend deployen (een 7-arg-call naar de nog-6-arg-RPC faalt; andersom resolvet backward-compatible). Zelfde volgorde aanhouden bij elke toekomstige named-arg-uitbreiding.
- **Labelbarcode ≠ per-carrier scancode-configuratie.** De oude `app_config`-vlaggen `scancode_met_00_prefix`/`sscc_met_00_prefix` zijn geschrapt (2026-06-14) — een carrier die kale SSCC zonder AI(00)-prefix wil, krijgt een capability-veld in de registry, geen losse config-vlag.
- **Print-marge/schaal:** `padding:0 !important` op het label-CSS nult de fysieke marge — labelprint is niet zelf verifieerbaar door een agent, altijd door de gebruiker laten testen na een label-CSS-wijziging. Schaal-berekeningen gebruiken `BASIS_*_MM`, niet `DEFAULT_LABEL_*_MM`.

## Openstaand / V2

- **Verhoek `verhoek_sftp.actief=FALSE`** tot de rondreis-test (dry-run via SFTP) geslaagd is — code is compleet + unit-getest, deployment/rondreis nog open.
- **Rhenus HPLT-footprint (80×60) is een aanname** — te bevestigen door Rhenus.
- **Rhenus `<height>`-dimensie op een pallet-bundel** staat niet in het legacy-referentiebestand (alleen depth+width) — bevestiging bij Rhenus nog open, samen met de HPLT-footprint.
- **HST lange-colli-pakkettypes** (col/BDLS/LNGT) — geblokkeerd totdat HST die pakkettypes aan hun kant openzet.
- **Diagnose-UI voor `externe_payloads`** staat op de backlog (huidige toegang is puur via query/logs).
- **Orchestrator-loop-generalisatie** (claim-loop/reaper/secret-resolutie over de 3 carriers) — bewust nog niet gedaan, ADR-0035 noemt dit expliciet als toekomstige stap.
