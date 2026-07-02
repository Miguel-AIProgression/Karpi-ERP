# Verbeterplan: Verzend-orchestrator-skeleton als één deep module

**Datum:** 2026-06-14
**Status:** plan — nog niet geïmplementeerd
**Voorganger:** [`2026-06-13-vervoerder-capability-seam.md`](2026-06-13-vervoerder-capability-seam.md) §6 (sibling-kandidaat "process-queue-skeleton") — capability-seam (ADR-0034) is geland, dus dit is nu aan de beurt
**Raakt:** [`hst-send/index.ts`](../../../supabase/functions/hst-send/index.ts) (404 r), [`verhoek-send/index.ts`](../../../supabase/functions/verhoek-send/index.ts) (303 r), [`rhenus-send/index.ts`](../../../supabase/functions/rhenus-send/index.ts) (297 r)
**Voorgestelde ADR:** ADR-0035 — verzend-orchestrator-skeleton (process-as) naast capability-as (ADR-0034) en keuze-as (ADR-0008/0030)

---

## 1. Probleem

De drie verzend-edge-functions delen een vrijwel identiek loop-skelet:

```
auth (Bearer CRON_TOKEN)
 → secrets/dry-run resolven
 → (config uit app_config laden)
 → reaper-RPC (herstel_vastgelopen_*)
 → claim-loop (MAX_PER_RUN, tijdsbudget-break):
     claim_volgende_*_transportorder
      → fetch zending + order + bedrijfsgegevens
      → fetchZendingColli
      → preflight (valideerVoorVervoerder + colli)
      → build payload/XML
      → transport (REST POST / SFTP put, of dry-run)
      → log_externe_payload (audit, best-effort)
      → markeer_*_verstuurd / markeer_*_fout
 → summary
```

Alléén het **renderen** (payload/XML) en het **transport** (REST vs SFTP) zijn écht
carrier-specifiek. De rest — auth, reaper, claim-loop, context-fetch, preflight-aanroep,
audit, status-transitie, retry — staat **drie keer**. De deletion-test is overtuigend: schrap
twee van de drie loops en exact dezelfde complexiteit komt terug bij de volgende vervoerder
(de vierde-vervoerder-acceptance uit het capability-plan zegt nog steeds "één format-adapter
**+ orchestrator**" — die orchestrator is de kopie die dit plan wegneemt).

### Bewijs dat het skelet zijn plek verdient

- **Geen enkele test** op de loops (`Glob` op `*-send/**/*.test.ts` → alleen `payload-builder`,
  `xml-builder`, `hst-client`). De loops zijn nu **alleen end-to-end testbaar** — precies wat een
  skeleton-met-fake-adapter zou repareren.
- **Drift is al ontstaan** (zie §3): HST mist de tijdsbudget-break die Verhoek/Rhenus wél hebben;
  de 0-colli-guard zit op drie verschillende plekken in drie verschillende vormen; HST heeft een
  aparte `logCarrierPayload`-helper terwijl Verhoek/Rhenus inline auditen. Eén skelet = één plek
  voor zulke fixes i.p.v. drie-keer-bijna.

---

## 2. Wat is écht verschillend (en moet de adapter bezitten)

Onderstaande inventaris is de kern van de risico-analyse: elke regel is een punt waar een naïeve
merge gedrag zou veranderen. Geclassificeerd als **DESIGN** (bewust verschil → adapter-callback) of
**DRIFT** (toevallige inconsistentie → opschonen, ná de skeleton).

| # | Aspect | HST | Verhoek | Rhenus | Klasse |
|---|---|---|---|---|---|
| 1 | Protocol/transport | REST POST (`postTransportOrder`) | SFTP (`uploadXmlViaSftp`) | SFTP | **DESIGN** |
| 2 | Dry-run | nee | ja (`VERHOEK_DRY_RUN`) | ja (`RHENUS_DRY_RUN`) | **DESIGN** |
| 3 | Secret-validatie | altijd HST_API_* eisen | SFTP-secrets alléén als `!dryRun` | idem | **DESIGN** |
| 4 | app_config-opties | geen | sleutel `'verhoek'` | sleutel `'rhenus'` | **DESIGN** |
| 5 | Claim-RPC | `claim_volgende_hst_transportorder` | `..._verhoek_...` | `..._rhenus_...` | **DESIGN** (naam) |
| 6 | Reaper-RPC | `herstel_vastgelopen_hst` | `..._verhoek` | `..._rhenus` | **DESIGN** (naam) |
| 7 | Claim-return | géén `bestandsnaam` | + `bestandsnaam` | + `bestandsnaam` | **DESIGN** |
| 8 | Zending-select | + `totaal_gewicht_kg, aantal_colli, opmerkingen, afl_email` | + `opmerkingen, afl_email` | basis (géén opmerkingen/email) | **DESIGN** (adapter levert kolomlijst) |
| 9 | Order-select | `order_nr` | `order_nr` | `order_nr, klant_referentie` | **DESIGN** |
| 10 | 0-colli-afhandeling | expliciete `length===0` → hard Fout | expliciete `length===0` → hard Fout | via `valideerRhenusColli` (capability `vereistColli`) | **DRIFT** |
| 11 | Preflight-extra | geen | + colli-validatie + `opdrachtgever_nummer`-guard | + colli-validatie | **DESIGN** (colli via capability) |
| 12 | Bestandsnaam-dedup | n.v.t. (REST) | persisteer vóór upload | persisteer vóór upload | **DESIGN** |
| 13 | Build-input | `{zending, order, bedrijf, hstCustomerId, colli}` | `{..., opties, colli}` | `{..., opties, colli, nu:Date}` | **DESIGN** |
| 14 | Audit-vorm | `logCarrierPayload`-helper, JSON, `transport_order_id`/`tracking` | inline, XML, `bestandsnaam`/`remote_pad`/`dry_run` | inline, XML, idem | **DRIFT** (vorm) + **DESIGN** (payload_json-inhoud) |
| 15 | Succes-side-effect | PDF→storage + `markeer_hst_verstuurd(transport_order_id, tracking, pdf_path...)` | XML→storage + `markeer_verhoek_verstuurd(bestandsnaam, storage_path, track_trace_id)` | XML→storage + `markeer_rhenus_verstuurd(bestandsnaam, storage_path)` | **DESIGN** |
| 16 | Fout-RPC-signature | `markeer_hst_fout(request/response_payload, http_code)` | `markeer_verhoek_fout(request_xml)` | `markeer_rhenus_fout(request_xml)` | **DESIGN** |
| 17 | Tijdsbudget-break (60s) | **ontbreekt** | aanwezig | aanwezig | **DRIFT** |
| 18 | Summary-shape | géén `dry_run`-veld | + `dry_run` | + `dry_run` | **DRIFT** (harmoniseren) |

**Conclusie:** ~10 DESIGN-verschillen (echte carrier-eigenschappen → moeten via de adapter), ~5 DRIFT-punten
(toevallige inconsistenties → de skeleton dwingt ze gelijk; dat is netto-winst maar gedrágs-wijzigend, dus apart slicen).

---

## 3. Risico's van het samenvoegen

Dit raakt het **live geld-/klantpad** (HST is de enige actieve verzendkoppeling; een regressie =
geen verzendlabels = magazijn staat stil). Eerlijke weging:

1. **Geen test-vangnet vóór de refactor.** De loops worden nu nergens geünit-test. Blind refactoren
   van een live pad is onverantwoord → **slice 0 (karakterisatie-tests met fake SupabaseClient) is
   een harde voorwaarde, geen optie.**
2. **HST is live; Rhenus staat vlak vóór go-live** (rondreis geslaagd, wacht op format-akkoord).
   Een merge die HST raakt tijdens de Rhenus-cutover stapelt twee risico's. → **HST als laatste
   migreren, los van de Rhenus-go-live-week.**
3. **DESIGN vs DRIFT door elkaar halen.** Als de skeleton per ongeluk een bewust verschil
   "opschoont" (bv. de 0-colli-guard van HST/Verhoek verzwakt naar Rhenus' capability-route, of een
   strengere colli-eis op de verkeerde carrier toepast) verandert het preflight-gedrag stil. →
   **DRIFT-opschoning expliciet in een aparte slice ná de gedragsneutrale migratie, elk met
   golden-test.**
4. **RPC-signature-koppeling.** `markeer_*_verstuurd/fout` hebben echt verschillende parameters. De
   adapter moet die volledig bezitten (callback, geen generieke parameterlijst) — anders lekt een
   carrier-detail in de skeleton.
5. **Edge-deploy-granulariteit.** Drie aparte functions delen straks `_shared/verzend-orchestrator.ts`.
   Een wijziging daar vereist **alle drie** redeployen. Mitigatie: de skeleton wordt na landing
   zelden geraakt (dat is juist het doel); deploy-checklist documenteert de fan-out.
6. **`Date.now()`/`new Date()` in de skeleton** (tijdsbudget + Rhenus' `nu`). Blijft prima in een
   edge-function (geen workflow-resume-constraint hier), maar moet injecteerbaar zijn voor de
   karakterisatie-test (klok als parameter).

**Niet-risico's (bewust):** de format-builders blijven ongemoeid (echte protocolverschillen,
by-design — net als in het capability-plan); de keuze-as en `enqueue_zending_naar_vervoerder`-dispatch
blijven ongewijzigd.

---

## 4. Doelbeeld

Eén pure-ish skeleton + drie dunne adapters:

```ts
// _shared/verzend-orchestrator.ts
export interface VerzendAdapter<Row, Payload, Result> {
  kanaal: string;                       // 'hst' | 'verhoek' | 'rhenus' (audit + logging)
  capabilityCode: string;               // descriptor-lookup (preflight, maxPerRun)
  contentType: 'application/json' | 'application/xml';

  resolveRuntime(env: Env): RuntimeOrError<Ctx>;   // secrets/dry-run/sftp-config/opties
  reaper(supabase): Promise<void>;                  // herstel_vastgelopen_*
  claim(supabase): Promise<Row | null>;             // claim_volgende_*

  zendingSelect: string;                            // adapter-specifieke kolomlijst (#8)
  orderSelect: string;                              // 'order_nr' | 'order_nr, klant_referentie'
  eistColli: boolean;                               // 0-colli hard-fout vóór build? (#10, geharmoniseerd)

  preflightExtra?(ctx, z, colli): string[];         // opdrachtgever_nummer-guard (Verhoek)
  build(input): { payload: Payload; bestandsnaam?: string; externeId: string | null };
  persistBestandsnaam?(supabase, row, naam): Promise<string | null>;  // SFTP-dedup (#12)
  transport(ctx, payload, bestandsnaam?): Promise<Result>;            // REST/SFTP/dry-run
  auditPayloadJson(payload, result): unknown;       // carrier-specifieke audit-body (#14)
  onSucces(supabase, ctx, row, payload, result): Promise<void>;  // PDF/XML-storage + markeer_*_verstuurd
  onFout(supabase, row, payload, result): Promise<void>;         // markeer_*_fout
  markeerFoutTekst(supabase, rowId, tekst): Promise<void>;        // markFout-pad (context-fetch faalt)
}

export async function verwerkVerzendWachtrij<R,P,Res>(
  adapter: VerzendAdapter<R,P,Res>, supabase, env, klok: () => number,
): Promise<SendSummary> { /* het ene skelet */ }
```

De skeleton bezit: auth-check (in de `Deno.serve`-wrapper per function — die blijft dun), reaper-call,
claim-loop + MAX_PER_RUN (uit capability) + tijdsbudget-break (#17, nu overal), context-fetch
(zending/order/bedrijf met adapter-kolomlijsten), colli-fetch + 0-colli-guard (#10 geharmoniseerd via
`eistColli`), preflight-aanroep (`valideerVoorVervoerder` + `valideerColli` uit de capability-seam +
`preflightExtra`), audit-call (`log_externe_payload` met `adapter.kanaal`/`contentType`/`auditPayloadJson`),
en de succes/fout-dispatch naar de adapter-callbacks. Summary-shape uniform met `dry_run` (#18).

---

## 5. Verticale slices (elk los mergebaar, gedragsneutraal tenzij vermeld)

### Slice 0 — Karakterisatie-vangnet (VERPLICHT, geen gedragswijziging)
- Bouw een fake `SupabaseClient` (recorder: legt `.from().select().eq().single()`-resultaten + `.rpc()`-aanroepen vast) in `_shared/__tests__/fake-supabase.ts`.
- Schrijf per carrier een karakterisatie-test die de **huidige** `verwerkRow` voedt met een vaste zending/order/colli en de **exacte reeks RPC-aanroepen + argumenten** vastlegt als golden snapshot (succes-pad, fout-pad, 0-colli-pad, preflight-fout-pad).
- Dit is het contract waartegen slice 1–3 bewijzen "niets veranderd".
- *Subtiliteit:* de huidige `verwerkRow`'s zijn niet geëxporteerd → eerst exporteren (triviale, gedragsneutrale edit) zodat de test ze direct kan aanroepen.

### Slice 1 — Skeleton + Verhoek-adapter (laagste risico: dry-run, niet live)
- Schrijf `_shared/verzend-orchestrator.ts` (de skeleton) + `VerhoekAdapter`.
- `verhoek-send/index.ts` wordt: auth-wrapper → `verwerkVerzendWachtrij(verhoekAdapter, ...)`.
- **Bewijs:** Verhoek-karakterisatie-test uit slice 0 ongewijzigd groen + alle bestaande Deno-tests.

### Slice 2 — Rhenus-adapter op de skeleton
- `RhenusAdapter` + `rhenus-send/index.ts` op de skeleton. Let op `klant_referentie` (#9) en `nu:Date` (#13 → klok-injectie).
- **Bewijs:** Rhenus-karakterisatie-test groen. **Timing:** niet in dezelfde week als de Rhenus-go-live-cutover mergen.

### Slice 3 — HST-adapter op de skeleton (live pad — apart, na 1+2 bewezen)
- `HstAdapter`: REST-transport, PDF-storage-side-effect, JSON-audit (`logCarrierPayload` wordt `auditPayloadJson`), geen dry-run, geen bestandsnaam-dedup, andere markeer-signatures.
- **Bewijs:** HST-karakterisatie-test byte-voor-byte identieke RPC-call-sequence. Deploy in een rustig venster, monitor `hst_verzend_monitor` direct erna.

### Slice 4 — DRIFT opschonen (bewust gedrágs-wijzigend, nu één plek)
- Tijdsbudget-break nu óók effectief voor HST (#17) — was latente inconsistentie.
- 0-colli-guard uniform via `eistColli`/capability (#10) — verifieer dat HST/Verhoek dezelfde hard-fout houden.
- Summary `dry_run`-veld overal (#18).
- Elk punt eigen test + changelog-regel; dit is waar de skeleton zijn waarde aantoont.

---

## 6. Acceptance — vierde vervoerder ná dit plan
1. Eén capability-rij (ADR-0034, al bestaand).
2. Eén format-builder (`xyz-send/xml-builder.ts` of `payload-builder.ts`).
3. Eén `VerzendAdapter`-implementatie (~40 r: RPC-namen, selects, build/transport/markeer-callbacks).
4. Eén dunne `index.ts` (auth-wrapper + `verwerkVerzendWachtrij(adapter)`).
5. Routering = data (`vervoerder_selectie_regels` + `vervoerders`-rij).

Géén loop-kopie meer. Skeleton + reaper + audit + retry + tijdsbudget komen één keer.

---

## 7. Docs bij te werken
- **ADR-0035** aanmaken (process-as-skeleton; relatie tot ADR-0034 capability-as + ADR-0008/0030 keuze-as).
- **CLAUDE.md** — bullet onder de vervoerder-blokken: "Verzend-orchestrator = `_shared/verzend-orchestrator.ts` (één skeleton; carriers leveren een `VerzendAdapter`). Capability-as = `capabilities.ts`, keuze-as = `vervoerder_selectie_regels`."
- **architectuur.md** + **changelog.md** per geland slice.
- **Memory** `project_vervoerder_capability_seam.md` aanvullen met de skeleton-seam-status.
```
