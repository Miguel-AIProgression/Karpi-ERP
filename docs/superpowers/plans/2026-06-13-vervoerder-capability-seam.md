# Verbeterplan: Vervoerder-capability-seam

**Datum:** 2026-06-13
**Status:** slice 1–3 geïmplementeerd (branch `refactor/vervoerder-capability-seam`, 49 Deno-tests groen); slice 4 optioneel/open
**ADR:** ADR-0034 — vervoerder-capability als één descriptor-registry
**Voorgestelde migratie (optioneel, slice 4):** 395

---

## 1. Probleem

ADR-0008 (mig 208–210) en ADR-0030 (mig 336) maakten de vervoerder-**keuze** data-driven:
welke vervoerder een zending krijgt, komt uit `vervoerder_selectie_regels` (JSONB-condities,
prio-ladder) + de `override → regel → geen`-resolver. Die as is goed.

Maar de **eisen en eigenschappen** van elke vervoerder — landbereik, verplichte velden,
default-afmetingen, protocoltak, batch-limieten — staan nog **hardcoded en verspreid** over
minstens zes plekken, en de capability-as groeit per code-edit mee bij elke nieuwe vervoerder.
Er zijn nu drie adapters (HST, Verhoek, Rhenus); een vierde raakt 4–5 bestanden zonder dat er
één plek is waar "wat kan/eist deze vervoerder" leesbaar staat.

### Waar de capability-as nu verspreid leeft

| Capability-dimensie | Huidige locatie(s) | Vorm |
|---|---|---|
| **Landbereik** | [`_shared/vervoerder-eisen.ts:30`](../../../supabase/functions/_shared/vervoerder-eisen.ts#L30) `HST_LANDEN_BEREIK=['NL']` | const, alléén HST; Verhoek/Rhenus hebben géén declaratief bereik (leunen op selectie-regels) |
| **Welke carriers preflight kennen** | [`vervoerder-eisen.ts:46`](../../../supabase/functions/_shared/vervoerder-eisen.ts#L46) `['hst_api','verhoek_sftp','rhenus_sftp']` **2×** (regel 46 + 56) | hardcoded carrier-code-array, dubbel |
| **Verplichte velden (preflight)** | `vervoerder-eisen.ts:56–90` — per-carrier `if`-takken (telefoon = HST; adresvelden = alle; land = HST) | branch-logica, niet declaratief |
| **Colli-eisen** | [`verhoek-send/xml-builder.ts:38`](../../../supabase/functions/verhoek-send/xml-builder.ts#L38) `valideerVerhoekColli` (sscc/lengte/breedte/gewicht) vs. [`rhenus-send/xml-builder.ts:49`](../../../supabase/functions/rhenus-send/xml-builder.ts#L49) `valideerRhenusColli` (sscc/lengte/gewicht **+ 0-colli-guard**) | twee bijna-identieke functies, subtiel verschillend |
| **Default-afmetingen** | [`hst-send/payload-builder.ts:33–36`](../../../supabase/functions/hst-send/payload-builder.ts#L33-L36) `DEFAULT_LENGTH/WIDTH/HEIGHT/WEIGHT=120/80/20/1` | hardcoded, alléén HST (Verhoek/Rhenus eisen echte dims) |
| **Protocoltak** | SQL `enqueue_zending_naar_vervoerder` — `WHEN 'sftp'`/dispatch-takken (mig 375/380); `vervoerders.type IN ('api','edi')` (mig 170, label klopt niet meer: SFTP ≠ EDI) | SQL-CASE + verkeerd-gelabelde kolom |
| **Batch-limiet** | `index.ts` `MAX_PER_RUN=25` **3×** hardcoded | per-adapter const |

### Deletion-test (waarom dit een echte seam is)

Verwijder je `HST_LANDEN_BEREIK` + de carrier-code-arrays uit `vervoerder-eisen.ts`, dan duikt
de complexiteit weer op bij **elke** send-functie: ieder krijgt zijn eigen land-check, eigen
"ken ik deze carrier"-lijst, eigen default-tabel. De logica concentreert dus rond één begrip —
"de capabilities van een vervoerder" — maar heeft nog geen huis. Dat is precies de signatuur
van een ontbrekende deep module.

### Wat **niet** het probleem is (bewust buiten scope)

- **De keuze-as** (`vervoerder_selectie_regels`, resolver) — al data-driven, ongemoeid.
- **De format-builders zelf** (`bouwTransportOrderPayload`/`bouwVerhoekXml`/`bouwRhenusXml`) en de
  adres-split-verschillen — dit zijn **echte** protocolverschillen (REST/JSON vs. AA2.0-XML vs.
  GS1-XML; decagram vs. kg; 4-veld vs. 2-veld vs. 1-regel-adres). By-design, net als analoog **F**
  in de SSCC-audit. Eén descriptor maakt die builders niet uniform en dat moet ook niet.
- **De orchestrator-loop-skeletten** (`verwerkRow` in elke `index.ts`: claim → fetch → preflight →
  build → upload → audit → markeer) zijn óók gedupliceerd, maar dat is een **aparte** seam
  ("process-queue-skeleton"), niet de capability-as. Genoteerd als sibling-kandidaat in §6 — niet
  in dit plan, om scope-creep te vermijden.

---

## 2. Doelbeeld

Eén canonieke, pure descriptor per vervoerder die de **declaratieve** capability-as draagt:

```ts
// supabase/functions/_shared/vervoerders/capabilities.ts
export interface VerzendCapability {
  code: string;                  // 'hst_api' | 'verhoek_sftp' | 'rhenus_sftp'
  protocol: 'rest' | 'sftp';     // hoe de adapter aflevert (vervangt vervoerders.type-misbruik)
  landbereik: string[] | null;   // ISO-2 lijst; null = onbegrensd (routering bepaalt bereik)
  preflight: {
    vereistTelefoon: boolean;    // HST: belt vóór aflevering
    vereistLandInBereik: boolean;// HST: harde land-check; SFTP: false (routering doet dit)
    vereistAdresvelden: boolean; // alle: naam/adres/postcode/plaats
    vereistColli: boolean;       // Rhenus: ≥1 colli (incident 0455395)
    colliVelden: ColliVeld[];    // welke per-colli velden verplicht zijn
  };
  defaultAfmetingen: { lengteCm: number; breedteCm: number; hoogteCm: number; gewichtKg: number } | null;
  // null = géén default toegestaan → ontbrekende dims falen preflight i.p.v. verzonnen worden
  maxPerRun: number;
}

export const VERZEND_CAPABILITIES: Record<string, VerzendCapability> = { /* 3 rijen */ };
```

**Eén plek** waar de capability-as leesbaar staat; consumers lezen de descriptor i.p.v. eigen
`if code === `-takken te dragen. Een vierde vervoerder toevoegen = **één registry-rij + één
format-adapter**, geen sweep over preflight/defaults/colli-validatie.

### Locality & het pure-seam-contract

De preflight (`vervoerder-eisen.ts`) is **bewust puur** (geen DB/secrets) zodat de frontend hem via
de re-export-shim ([`frontend/src/lib/orders/vervoerder-eisen.ts`](../../../frontend/src/lib/orders/vervoerder-eisen.ts), ADR-0033)
deelt zonder DB-round-trip. De registry erft die eigenschap: **pure TS-constant, géén DB-lezing**.

De `vervoerders`-tabel (mig 170) blijft de **administratieve** bron (`actief`, `display_naam`,
routering-FK). De descriptor draagt de **gedragsmatige** capability. Die twee moeten consistent
zijn — geborgd via een golden-file-contracttest (slice 4), exact het bestaande patroon
`bundel-sleutel.contract` / `normaliseer-land.contract` (ADR-0033).

---

## 3. Verticale slices

Elke slice is los te mergen, gedragsneutraal tenzij anders vermeld, en heeft een test als vangnet.

### Slice 1 — Registry + preflight leest descriptor (gedragsneutraal)

**Doel:** de `if code === `-takken en dubbele carrier-arrays in `vervoerder-eisen.ts` vervangen door
een lookup in `VERZEND_CAPABILITIES`. Geen extern gedrag verandert.

- Nieuw: [`_shared/vervoerders/capabilities.ts`](../../../supabase/functions/_shared/vervoerders/) met de drie descriptors. `HST_LANDEN_BEREIK` wordt `capabilities['hst_api'].landbereik` (oude export als deprecated alias laten staan tot consumers om zijn).
- `valideerVoorVervoerder(ctx)`: lookup descriptor op `ctx.vervoerder_code`; onbekende code → `{ ok: true }` (huidig gedrag). Bouw `problemen[]` declaratief uit `preflight.vereist*`.
- **Vangnet:** breid `vervoerder-eisen.test.ts` uit zodat de bestaande HST/Verhoek/Rhenus-cases identieke output geven (golden-snapshot vóór/ná de refactor).
- **Contract met de frontend-shim:** de re-export blijft hetzelfde oppervlak; geen frontend-edit nodig.

### Slice 2 — HST-defaults + maxPerRun uit de registry

**Doel:** `DEFAULT_LENGTH/WIDTH/HEIGHT/WEIGHT_CM` en `MAX_PER_RUN` ophouden 3× te dupliceren.

- `payload-builder.ts` leest `defaultAfmetingen` uit de HST-descriptor i.p.v. lokale consts (de `DEFAULT_*`-consts worden afgeleid, niet apart gedefinieerd).
- De drie `index.ts` lezen `maxPerRun` uit hun descriptor.
- **Let op:** dit raakt de A2/C-analogen uit de SSCC-audit (gewicht/afmetingen-bron). De *default-waarden* centraliseren is veilig en orthogonaal; de *echte* dims-bron-divergentie blijft een aparte backlog-post (audit-analoog C). Niet vermengen — alleen de hardcoded fallback-getallen verhuizen.
- **Vangnet:** `payload-builder.test.ts` ongewijzigd groen (zelfde getallen).

### Slice 3 — Colli-eisen declaratief uit `preflight.colliVelden`

**Doel:** `valideerVerhoekColli` en `valideerRhenusColli` convergeren naar één generieke
`valideerColli(colli, capability)` die de verplichte velden + 0-colli-guard uit de descriptor leest.

- Nieuw: `valideerColli(colli, cap)` in `_shared/vervoerders/` — leest `cap.preflight.vereistColli`
  (0-colli-guard) en `cap.preflight.colliVelden` (sscc/lengte/breedte/gewicht per carrier).
- Verhoek-descriptor: `colliVelden=['sscc','lengte','breedte','gewicht']`, `vereistColli=false`.
- Rhenus-descriptor: `colliVelden=['sscc','lengte','gewicht']`, `vereistColli=true`.
- De adapter-specifieke `valideerVerhoekColli`/`valideerRhenusColli` worden dunne wrappers (of
  verdwijnen) — de meldingsteksten behouden (incident 0455395-tekst voor Rhenus blijft).
- **Belangrijk:** dit is de subtielste slice — de twee functies verschillen écht (breedte verplicht
  bij Verhoek, niet bij Rhenus; 0-colli alleen Rhenus). De descriptor moet dat verschil exact
  dragen, anders verzwak/verscherp je per ongeluk een preflight. Golden-test eerst.
- **Vangnet:** beide bestaande `xml-builder.test.ts` colli-validatie-cases ongewijzigd groen.

### Slice 4 — SQL↔TS-contracttest + `vervoerders`-tabel uitlijnen (optioneel, mig 395)

**Doel:** borgen dat de TS-registry en de DB-administratie niet uiteenlopen, en `vervoerders.type`
corrigeren.

- Golden-fixture `frontend/src/lib/orders/__tests__/golden/vervoerder-capabilities.golden.json`:
  per carrier-code → `{ protocol, landbereik, actief-verwacht }`. Vitest-contracttest + (optioneel)
  een SQL-assert die `vervoerders` tegen de golden toetst (`assert_vervoerder_capability_contract()`).
- Mig 395 (optioneel): kolom `vervoerders.protocol TEXT` ('rest'|'sftp') naast de bestaande
  `type` (die als legacy 'api'/'edi' label blijft of wordt opgeschoond). Géén gedragswijziging in de
  dispatch — `enqueue_zending_naar_vervoerder` blijft op de bestaande CASE; de kolom maakt alleen
  de protocoltak *leesbaar* en toetsbaar tegen de registry.
- **Waarom optioneel:** de waarde van slice 1–3 staat los hiervan. Slice 4 is de "borg dat het niet
  weer divergeert"-laag; doe 'm als slice 1–3 landen.

---

## 4. Wat een vierde vervoerder toevoegen wordt (acceptance)

Vóór dit plan (huidige situatie): bewerk `vervoerder-eisen.ts` (2 arrays + preflight-tak), voeg
defaults toe in een payload-builder, schrijf een `valideerXColli`, voeg een SQL-dispatch-tak toe,
zet `MAX_PER_RUN` ergens. → **4–5 bestanden, verspreide edits.**

Ná dit plan:
1. **Eén registry-rij** in `VERZEND_CAPABILITIES` (landbereik, preflight-eisen, defaults, protocol, maxPerRun).
2. **Eén format-adapter** (`xyz-send/` met eigen builder + orchestrator — dat blijft per protocol nodig).
3. Routering = **data** (`vervoerder_selectie_regels`-rij + `vervoerders`-rij), zoals nu al.
4. Golden-fixture-rij bijwerken (slice 4).

De capability-as is dan **op één plek leesbaar en direct testbaar** i.p.v. via drie send-paden.

---

## 5. Risico's & aandachtspunten

- **Slice 3 is gedragsgevoelig:** de Verhoek/Rhenus colli-validaties verschillen subtiel. Golden-snapshot vóór de refactor is verplicht; niet "opschonen" wat in werkelijkheid een bewust verschil is.
- **Pure-seam mag niet breken:** géén DB-lezing in de registry, anders verliest de frontend-shim zijn DB-vrije eigenschap (ADR-0033). De `vervoerders`-tabel blijft een *spiegel* via contracttest, geen runtime-bron voor de preflight.
- **Niet vermengen met de gewicht/afmetingen-databron-fix** (SSCC-audit analoog A2/C). Dit plan verhuist alleen *default-getallen* en *eisen*, niet de vraag "welke bron is canoniek voor het werkelijke gewicht/de maat". Coördineer als beide tegelijk lopen.
- **`vervoerders.type`-correctie** (slice 4) raakt mogelijk bestaande queries die op `type='edi'` filteren — grep vóór wijziging; daarom is type-opschoning optioneel en achter een eigen migratie.

---

## 6. Sibling-kandidaat (apart, niet in dit plan)

**Orchestrator-loop-skeleton-seam.** De drie `index.ts` delen het skelet claim → fetch
(zending/order/bedrijf) → preflight → build → upload → `log_externe_payload` → `markeer_*`. Alleen
`_shared/sftp-client.ts` is tot nu toe gegeneraliseerd; de loop is per adapter gespiegeld (bewuste
keuze bij Rhenus, ADR-0032). Een generieke `verwerkVerzendWachtrij(adapter)`-skeleton met
adapter-callbacks zou dat concentreren — maar dat is de **process-as**, niet de **capability-as**.
Aparte deepening; pas oppakken als de capability-seam (dit plan) is geland, zodat de adapter-callback
de descriptor als input kan nemen.

---

## 7. Docs bij te werken

- **ADR-0034** aanmaken (capability-descriptor als single source; relatie tot ADR-0008/0030 keuze-as en ADR-0033 pure-seam).
- **CLAUDE.md** — bullet onder de vervoerder-blokken: "Vervoerder-capability = `_shared/vervoerders/capabilities.ts` (één descriptor per carrier: landbereik/preflight-eisen/defaults/protocol); keuze-as blijft `vervoerder_selectie_regels`."
- **architectuur.md** + **changelog.md** per geland slice.
- Memory: nieuwe `project_vervoerder_capability_seam.md` zodra slice 1 landt.
