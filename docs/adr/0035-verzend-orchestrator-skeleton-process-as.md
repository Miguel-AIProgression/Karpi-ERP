# ADR-0035: Verzend-orchestrator-skeleton als één deep module (process-as)

**Status:** Geaccepteerd (2026-06-14) — alle slices (0 vangnet, 1 skeleton+Verhoek, 2 Rhenus, 3 HST, 4 drift) geïmplementeerd; 66 Deno-tests groen, gedragsneutraal bewezen via de karakterisatie-tests.

## Context

Er zijn drie verzend-edge-functions: [`hst-send`](../../supabase/functions/hst-send/index.ts)
(REST/JSON), [`verhoek-send`](../../supabase/functions/verhoek-send/index.ts) en
[`rhenus-send`](../../supabase/functions/rhenus-send/index.ts) (beide AA2.0/GS1-XML via SFTP). Elke
function draagt een eigen `verwerkRow` + claim-loop, terwijl ze een vrijwel identiek skelet delen:

```
auth (Bearer CRON_TOKEN) → secrets/dry-run resolven → (config uit app_config)
 → reaper-RPC → claim-loop (MAX_PER_RUN + tijdsbudget):
     claim → fetch zending/order/bedrijf → fetchZendingColli → preflight
      → build payload/XML → transport (REST/SFTP/dry-run)
      → log_externe_payload (audit) → markeer_*_verstuurd / markeer_*_fout
 → summary
```

Alléén het **renderen** (payload/XML) en het **transport** (REST vs SFTP) zijn écht
carrier-specifiek. De rest — auth, reaper, claim-loop, context-fetch, preflight-aanroep, audit,
status-transitie, retry — staat drie keer. ADR-0034 (vervoerder-capability-registry) maakte de
**declaratieve** capability-as data-driven en benoemde deze loop-duplicatie expliciet als aparte
**"process-as"-sibling-seam**, op te pakken zódra de capability-seam geland was. Dat is nu het geval.

Bewijs dat het skelet zijn plek verdient:
- **Geen enkele test** op de loops zelf — alleen op de pure helpers (`payload-builder`,
  `xml-builder`, `hst-client`, `capabilities`, `colli`). De loops zijn nu alléén end-to-end testbaar.
- **Drift is al ontstaan:** HST mist de 60s-tijdsbudget-break die Verhoek/Rhenus wél hebben; de
  0-colli-guard zit op drie plekken in drie vormen; HST heeft een aparte `logCarrierPayload`-helper
  terwijl Verhoek/Rhenus inline auditen. Eén skelet = één plek voor zulke fixes.
- **Deletion-test:** schrap je twee van de drie loops, dan komt exact hetzelfde skelet terug bij de
  volgende vervoerder. De vierde-vervoerder-acceptance uit ADR-0034 zegt nog steeds "één
  format-adapter **+ orchestrator**" — die orchestrator-kopie is wat dit ADR wegneemt.

Dit raakt het **live geld-/klantpad** (HST is de enige actieve verzendkoppeling; Rhenus staat vlak
vóór go-live). Een naïeve big-bang merge introduceert regressierisico zónder test-vangnet.

## Besluit

1. **Eén skeleton** `_shared/verzend-orchestrator.ts` met `verwerkVerzendWachtrij(adapter, supabase,
   env, klok)` draagt de **process-as**: auth-check (in de dunne `Deno.serve`-wrapper per function),
   reaper-call, claim-loop + `maxPerRun` (uit de capability) + tijdsbudget-break, context-fetch
   (zending/order/bedrijf met adapter-geleverde kolomlijsten), colli-fetch + 0-colli-guard,
   preflight-aanroep (`valideerVoorVervoerder` + `valideerColli` uit ADR-0034 + adapter-`preflightExtra`),
   audit (`log_externe_payload`) en de succes/fout-dispatch.
2. **Eén `VerzendAdapter`-interface** draagt wat écht per carrier verschilt: RPC-namen
   (claim/reaper/markeer), select-kolomlijsten, `build(input)→payload/bestandsnaam`, `transport()`
   (REST/SFTP/dry-run), audit-payload-body, en de succes/fout-side-effects (PDF- vs XML-storage,
   markeer-RPC met carrier-specifieke parameters). Geen carrier-detail lekt in de skeleton.
3. **Karakterisatie-tests eerst (slice 0, verplicht).** Een fake `SupabaseClient`-recorder legt de
   huidige `verwerkRow`-uitvoer vast als golden snapshot (exacte reeks RPC-aanroepen + argumenten,
   per pad: succes/fout/0-colli/preflight). De skeleton-migratie bewijst gedragsneutraliteit tegen
   dat contract. Zonder vangnet geen refactor op een live pad.
4. **Incrementele migratie, niet big-bang.** Slice 1 Verhoek (dry-run, niet live) → slice 2 Rhenus →
   slice 3 HST (live, apart venster, na de andere twee bewezen). Slice 4 schoont de drift op
   (tijdsbudget-break overal, 0-colli uniform, summary-shape) — bewust gedrágs-wijzigend, dus
   gescheiden van de gedragsneutrale migratie, elk met eigen test.

## Bewust buiten scope

- **De keuze-as** (`vervoerder_selectie_regels`, resolver, `enqueue_zending_naar_vervoerder`-dispatch)
  — al data-driven (ADR-0008/0030), ongemoeid.
- **De capability-as** (`_shared/vervoerders/capabilities.ts`) — al geland (ADR-0034); de skeleton
  *leest* de descriptor, verandert hem niet.
- **De format-builders zelf** (`bouwTransportOrderPayload`/`bouwVerhoekXml`/`bouwRhenusXml`) en de
  adres-split-verschillen — echte protocolverschillen, by-design. De adapter omhult ze, uniformeert
  ze niet.

## Consequenties

- De process-as staat op één plek, testbaar met een fake-adapter i.p.v. alleen end-to-end.
- Een vierde vervoerder = één capability-rij (ADR-0034) + één format-builder + één `VerzendAdapter`
  (~40 r) + dunne `index.ts`-wrapper. Géén loop-kopie meer.
- **Deploy-fan-out:** de drie functions delen straks `_shared/verzend-orchestrator.ts`; een wijziging
  daar vereist alle drie redeployen. Mitigatie: de skeleton wordt na landing zelden geraakt (dat is
  het doel); de deploy-checklist documenteert de fan-out.
- `Date.now()`/`new Date()` (tijdsbudget + Rhenus' `nu`) wordt als injecteerbare klok doorgegeven,
  zodat de karakterisatie-test deterministisch is.
- Slice 4 verandert bewust gedrag (HST krijgt de tijdsbudget-break; 0-colli-afhandeling
  geüniformeerd) — daarom apart, ná de gedragsneutrale migratie, met changelog-regel per punt.
