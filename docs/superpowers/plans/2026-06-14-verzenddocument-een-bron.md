# Verzenddocument-bron: label én pakbon uit één colli-expansie

**Datum:** 2026-06-14
**Type:** pure frontend/TS-refactor (geen migratie, geen schema-wijziging, geen edge-function)
**Aanleiding:** voorstel #2 uit de architectuur-deepening — de laatste structurele divergentie in de print-laag na de SSCC- (a046e88) en omschrijving-single-source-fix (mig 388/390).

---

## 1. Wat het voorstel is

De `zending_colli`-snapshot is sinds mig 209/388/390/399/400 de **canonieke bevroren bron** per fysieke colli: `sscc`, `gewicht_kg`, `omschrijving_snapshot`, `klant_omschrijving_snapshot`, `lengte_cm`/`breedte_cm`, `aantal`. Eén SQL-seam (`genereer_zending_colli`) beslist wat erin komt; HST/Verhoek/Rhenus én de labels lezen die.

**Toch leiden label en pakbon hun print-rijen nog onafhankelijk af:**

| Aspect | Verzendlabels (`expandLabels`) | Pakbon (`PakbonDocument`) |
|---|---|---|
| Granulariteit | **per colli** ([printset.ts:86-93](../../../frontend/src/modules/logistiek/lib/printset.ts#L86-L93)) | **per orderregel** ([pakbon-document.tsx:69-110](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx#L69-L110)) |
| colli→regel-map | `regelPerOrderRegel` (eigen Map) | `snapshotPerOrderRegel` + `regelsPerOrder` (eigen Maps, opnieuw gebouwd) |
| Sortering | `colli_nr` | `order_regels.regelnummer` |
| Aantal | n.v.t. (1 label/colli) | eigen `geleverdAantal()`-fallback, **géén colli-count** ([pakbon-document.tsx:17-19](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx#L17-L19)) |
| Gewicht | n.v.t. | eigen `regelGewichtKg()`-fallback + `totaal_gewicht_kg` ([pakbon-document.tsx:21-25,112-114](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx#L21-L25)) |
| Tests | `printset.test.ts` (5 scenario's) | **geen** |

De omschrijving is al één bron; de **rij-opbouw, sortering, aantal- en gewicht-afleiding** zijn dat niet. Dat is exact de klasse waar het overlossing-incident van 12-06 uit kwam: twee onafhankelijke afleidingen van dezelfde fysieke werkelijkheid die geruisloos kunnen driften.

**Doel:** één `bouwVerzenddocument(zending)` die de zending éénmaal expandeert naar canonieke rijen, geconsumeerd door zowel de drie labelvarianten als de pakbon. De pakbon-specifieke groepering-per-bron-order (mig 222) blijft een dunne presentatielaag erbovenop.

---

## 2. De kern-subtiliteit: granulariteit verschilt (1 colli = 1 stuk)

`genereer_zending_colli` maakt **1 colli per stuk** — bevestigd in [mig 400:93,124](../../../supabase/migrations/400_colli_artikelnr_join_fix.sql#L93): `FOR i IN 1..GREATEST(r.aantal,1)` met `aantal=1` hardcoded per rij. Dus een zending_regel met `aantal=3` → **3 colli-rijen**.

Gevolg voor de samenvoeging:
- **Labels** willen **N rijen** (1 sticker per fysiek pak) — `expandLabels` doet dit al goed.
- **Pakbon** wil **1 regel per artikel** met kolommen *Besteld* (`order_regels.orderaantal`) en *Geleverd* (= het aantal stuks in deze zending).

"Label én pakbon consumeren dezelfde rijen" is dáárom **niet** letterlijk waar: de pakbon moet de colli-rijen **terug-aggregeren** naar orderregel-niveau. Een naïeve gedeelde laag die alleen `LabelItem[]` teruggeeft, zou de pakbon óf per-colli laten tonen (fout — klant wil 1 regel/artikel) óf de aggregatie alsnog in de pakbon laten (geen winst).

**Ontwerp-conclusie:** de gedeelde functie levert **twee afgeleide views uit dezelfde expansie**:

```ts
interface Verzenddocument {
  /** 1 rij per fysieke colli — voedt de labels (1:1). */
  colliRijen: ColliRij[]
  /** Per orderregel geaggregeerd (geleverd = count colliRijen) — voedt de pakbon. */
  pakbonRegels: PakbonRegel[]
  colliTotaal: number
  totaalGewichtKg: number
}
```

Beide views komen uit één expansie en één colli→regel-map. De labels mappen 1:1 op `colliRijen`; de pakbon groepeert `pakbonRegels` per bron-order (mig 222) puur voor de presentatie.

---

## 3. Risico-analyse van het samenvoegen

| # | Risico | Ernst | Mitigatie |
|---|---|---|---|
| **R1** | **Granulariteit-aggregatie (kern).** Pakbon moet colli→orderregel terug-aggregeren; naïef samenvoegen breekt óf de pakbonweergave óf de labels. | Hoog | Gedeelde laag levert **beide** views (`colliRijen` + `pakbonRegels`) uit één expansie — niet één lijst die de pakbon misbruikt. Expliciet getest. |
| **R2** | **"Besteld" zit niet in de colli-expansie.** Colli kent alleen *geleverd* (count). De pakbon-kolom *Besteld* komt uit `order_regels.orderaantal`. | Midden | `PakbonRegel` draagt zowel `besteld` (uit orderregel) als `geleverd` (count). De aggregatie leest de orderregel-context, niet alleen de colli. |
| **R3** | **Legacy-pad (zending zónder colli).** Pakbon rendert nu áltijd uit `zending_regels` en heeft colli niet nodig; labels hebben een aparte legacy-fallback. Via de gedeelde laag moet de pakbon voor oude/verzonden zendingen identiek blijven. | Hoog | Karakteriseringstest (R5) op een legacy-zending **vóór** de refactor; de gedeelde legacy-expansie (stuks uit `zending_regels.aantal`) voedt beide views, group-by reproduceert exact de huidige pakbonregels. |
| **R4** | **Print-CSS-fragiliteit.** Label- en pakbon-JSX hebben zwaar getunede `@media print`-regels (Zebra blanco-pagina-discipline, page-breaks). Aanraken = regressie-risico op de fysieke output. | Hoog | **Scope-grens: alleen de DATA-laag.** JSX en CSS van elk document blijven byte-voor-byte ongemoeid; alleen de *bron* van de props verandert. Geen enkele `style`/`@page`-regel in deze refactor. |
| **R5** | **Geen pakbon-tests.** Refactor zonder vangnet. | Hoog | **Eerst** karakteriseringstests (golden) op de huidige pakbon-rij-opbouw schrijven (besteld/geleverd/sortering/bundel-groepering/legacy), pas dán de bron omleggen. Rood-groen, geen output-wijziging. |
| **R6** | **Gewicht-bron-keuze.** Pakbon: `totaal_gewicht_kg` primair, anders `SUM(regelgewicht × aantal)`. Colli heeft per-colli gewicht; mig 391 synct `totaal = SUM(colli)`. | Laag | Gedeelde laag rekent `totaalGewichtKg = SUM(colliRijen.gewichtKg)` met fallback `zendingen.totaal_gewicht_kg` — consistent met HST. Query moet `zending_colli.gewicht_kg` ophalen (R8). Getest tegen de huidige uitkomst. |
| **R7** | **Bundel-groepering (mig 222).** Pakbon groepeert per bron-`order_id`; dat moet op de canonieke rij beschikbaar zijn. | Laag | `ColliRij`/`PakbonRegel` dragen `orderId` (uit `order_regels.order_id`, fallback `zending.orders.id`). De per-order-subkop blijft 100% in de pakbon-JSX (presentatie). |
| **R8** | **Query haalt colli-`aantal`/`gewicht_kg` niet op.** `fetchZendingPrintSet` select mist deze velden. | Laag | Select + `ZendingPrintColli`-type uitbreiden met `aantal`, `gewicht_kg`. Puur additief. |
| **R9** | **VERZEND/admin-pseudo-filter.** Beide filteren nu apart `isShippingRegel`. | Laag | De gedeelde laag filtert één keer; beide views erven dat. Bestaande test "VERZEND telt niet mee" dekt het. |
| **R10** | **Drie label-componenten + twee pagina's (single + bulk) consumeren `expandLabels`.** | Laag | `expandLabels` blijft bestaan als dunne wrapper rond `bouwVerzenddocument(z).colliRijen` → **geen** wijziging in `shipping-label*.tsx`, `dpd-shipping-label.tsx`, `zending-printset.tsx`, `bulk-printset.tsx`. |

**Netto-oordeel:** de waarde is reëel (locality + de pakbon krijgt eindelijk tests + colli-count wordt de echte *geleverd*-bron i.p.v. een losse fallback), maar de winst is **kleiner dan** de SSCC/omschrijving-fix, want die bron-divergenties zijn al weg. Het kern-risico is R1/R3/R4/R5. De refactor is alleen verantwoord als hij (a) puur de data-laag raakt, en (b) achter karakteriseringstests gebeurt die bewijzen dat label- én pakbon-output **byte-identiek** blijft. Lukt dat niet zonder de pakbon-presentatie te raken, dan is de duplicatie het kleinere kwaad — dan stoppen we na de tests + gewicht/aantal-consolidatie en laten de rij-opbouw zoals hij is.

---

## 4. Architectuur

```
queries/zendingen.ts   ── fetchZendingPrintSet (colli.aantal + gewicht_kg erbij)
                                   │  ZendingPrintSet
                                   ▼
lib/printset.ts ── bouwVerzenddocument(zending): Verzenddocument
                     ├── (intern) één colli-expansie + colli→regel-map + shipping-filter
                     ├── colliRijen   ──► expandLabels() (wrapper) ──► 3 labelvarianten  [JSX ongemoeid]
                     └── pakbonRegels ──► PakbonDocument                                  [JSX/CSS ongemoeid]
```

- **`bouwVerzenddocument`** is de enige plek waar de zending wordt geëxpandeerd, gesorteerd, gefilterd (shipping) en geaggregeerd.
- **`expandLabels`** blijft de publieke API voor de labels — wordt een one-liner (`return bouwVerzenddocument(z).colliRijen`), zodat de label-componenten en beide printset-pagina's onaangeraakt blijven.
- **`PakbonDocument`** verliest `geleverdAantal`, `regelGewichtKg`, `snapshotPerOrderRegel`, `regelsPerOrder`-opbouw en de sortering; krijgt `pakbonRegels` + `orderId`-groepering binnen. De volledige JSX (header, adresblokken, grid, footer, `@media print`) blijft identiek.

Geen DB-wijziging: alle data (aantal, gewicht, omschrijvingen, afmetingen, sscc) staat al op `zending_colli`.

---

## 5. File-structuur

| Bestand | Actie | Slice | Verantwoordelijkheid |
|---|---|---|---|
| `frontend/src/modules/logistiek/lib/printset.test.ts` | Modify | 1 | **Eerst:** karakteriseringstests pakbon-rijopbouw (besteld/geleverd/sortering/bundel/legacy/gewicht) |
| `frontend/src/modules/logistiek/queries/zendingen.ts` | Modify | 2 | colli-select + `ZendingPrintColli` uitbreiden met `aantal`, `gewicht_kg` |
| `frontend/src/modules/logistiek/lib/printset.ts` | Modify | 2 | `bouwVerzenddocument` + types; `expandLabels` wordt wrapper |
| `frontend/src/modules/logistiek/components/pakbon-document.tsx` | Modify | 3 | consumeert `pakbonRegels`; eigen maps/fallbacks weg; JSX/CSS ongemoeid |
| `frontend/src/modules/logistiek/lib/printset.test.ts` | Modify | 3 | groen tegen de nieuwe bron + regressie colli-count = geleverd |
| `docs/changelog.md` | Modify | 4 | entry 2026-06-14 |
| `CLAUDE.md` | Modify | 4 | bedrijfsregel-bullet uitbreiden (verzenddocument-één-bron) |
| `docs/superpowers/plans/2026-06-13-sscc-analogen-audit.md` | Modify | 4 | aanvink: structurele rij-opbouw geconsolideerd |

Niet aangeraakt (bewust): `shipping-label.tsx`, `shipping-label-tall.tsx`, `dpd-shipping-label.tsx`, `zending-printset.tsx`, `bulk-printset.tsx`, alle edge functions, alle migraties.

---

## 6. Taken

### Task 1: Branch + worktree
- [ ] Worktree + branch (memory `feedback_worktree_vanaf_start`):
```powershell
cd C:\Users\migue\Documents\Karpi ERP
git fetch origin; git checkout main; git pull --ff-only
git worktree add C:\Users\migue\Documents\Karpi-ERP-verzenddoc -b refactor/verzenddocument-een-bron
Copy-Item "C:\Users\migue\Documents\Karpi ERP\import\.env" "C:\Users\migue\Documents\Karpi-ERP-verzenddoc\import\.env" -ErrorAction SilentlyContinue
cd C:\Users\migue\Documents\Karpi-ERP-verzenddoc\frontend; npm install
```

### Task 2 (Slice 1 — vangnet eerst): karakteriseringstests pakbon
> Doel: bevries het **huidige** gedrag van de pakbon-rijopbouw vóór één regel verandert (memory `feedback_reviewer_na_parallel_agents`-geest: eerst meetbaar maken).

- [ ] **Step 1:** extraheer de pure pakbon-rijlogica testbaar. Twee opties — kies de minst-invasieve:
  - (a) test via een kleine geëxporteerde helper die de huidige `pakbon-document.tsx`-berekening (`regels`-sort, `regelsPerOrder`, `geleverdAantal`, `totaalGewicht`) 1-op-1 spiegelt, óf
  - (b) render-test met `@testing-library/react` op `PakbonDocument` en assert op tekst (besteld/geleverd/volgorde). Voorkeur (a): sneller, geen DOM, en het wordt straks de gedeelde laag.
- [ ] **Step 2:** scenario's (minimaal): 1 regel/3 stuks → geleverd=3, besteld=orderaantal; 2 regels sorteren op regelnummer; bundel met 2 orders → regels per order_id; **legacy-zending zonder colli** → identieke regels/aantallen als nu; gewicht-totaal = huidige uitkomst (totaal_gewicht_kg vs SUM-fallback).
- [ ] **Step 3:** `npx vitest run src/modules/logistiek/lib/printset.test.ts` → groen tegen de **huidige** code. Commit ("test: karakterisering pakbon-rijopbouw vóór consolidatie").

### Task 3 (Slice 2): `bouwVerzenddocument` + query
- [ ] **Step 1:** `queries/zendingen.ts` — `zending_colli`-select uitbreiden met `aantal, gewicht_kg`; `ZendingPrintColli` idem (`aantal: number | null`, `gewicht_kg: number | null`).
- [ ] **Step 2:** `printset.ts` — types `ColliRij`, `PakbonRegel`, `Verzenddocument` (zie §2). `bouwVerzenddocument(zending)`:
  - filter shipping-regels één keer (`isShippingRegel`);
  - colli-pad: sorteer op `colli_nr`, bouw colli→regel-map (hergebruik bestaande logica), produceer `colliRijen` met `orderId` (uit `regel.order_regels.order_id ?? zending.orders.id`) + per-colli `gewichtKg`;
  - `pakbonRegels`: group `colliRijen` op `orderRegelId`, `geleverd = count`, `besteld = order_regels.orderaantal`, `gewichtKg = SUM`, omschrijving-snapshot uit de eerste colli; sorteer op `order_regels.regelnummer`;
  - legacy-pad (geen colli): expandeer stuks uit `zending_regels.aantal` → `colliRijen` (sscc null), group dezelfde stuks → `pakbonRegels` (geleverd = aantal);
  - `totaalGewichtKg = SUM(colliRijen.gewichtKg) || zending.totaal_gewicht_kg`.
- [ ] **Step 3:** `expandLabels` → `return bouwVerzenddocument(zending).colliRijen`. Bestaande `printset.test.ts` SSCC-scenario's moeten **ongewijzigd** groen blijven (bewijst label-pad onaangeroerd).
- [ ] **Step 4:** `npm run typecheck` + vitest. Commit.

### Task 4 (Slice 3): pakbon omleggen
- [ ] **Step 1:** `pakbon-document.tsx` — vervang `geleverdAantal`/`regelGewichtKg`/`snapshotPerOrderRegel`/`regelsPerOrder`/sort door `bouwVerzenddocument(zending).pakbonRegels`. Groepeer per `orderId` voor de mig 222-subkoppen (presentatie blijft). `besteld`/`geleverd`/`kolli`/`totaalGewicht` uit het document. **Geen JSX-structuur of CSS wijzigen** — alleen de databron van de bestaande velden.
- [ ] **Step 2:** karakteriseringstests (Task 2) moeten **groen** blijven — byte-identieke output is de slaagvoorwaarde. Wijkt iets af → bug in de gedeelde laag, niet de test aanpassen.
- [ ] **Step 3:** `npm run typecheck` + `npx vitest run src/modules/logistiek`. Commit.

### Task 5 (Slice 4): documentatie + visuele check
- [ ] **Step 1:** print een verzendset (single + bulk) van een niet-verzonden me-colli-zending én een legacy-zending zonder colli; bevestig label + pakbon visueel identiek aan vóór de refactor (besteld/geleverd/sortering/gewicht/bundel-subkoppen).
- [ ] **Step 2:** `docs/changelog.md` entry; `CLAUDE.md`-bullet "Verzendlabel-SSCC…/Colli-omschrijving…" uitbreiden met de rij-opbouw-consolidatie; audit-doc afvinken.
- [ ] **Step 3:** commit.

### Task 6: merge-voorbereiding
- [ ] Full typecheck + `npx vitest run src/modules/logistiek`.
- [ ] Branch pushen; merge naar main **pas op expliciet commando** via `git push origin refactor/verzenddocument-een-bron:main` (memory `reference_merge_race_parallelle_sessies`). Geen migratienummer-collisie mogelijk (geen migratie).
- [ ] Worktree opruimen na merge.

---

## 7. Rollback & grenzen
- **Pure frontend, geen migratie/edge-function** → rollback = branch niet mergen of revert-commit; geen DB-staat om terug te draaien.
- **Slaagvoorwaarde is byte-identieke output.** Als de pakbon-presentatie niet te voeden is uit de gedeelde laag zónder JSX/CSS aan te raken, **stop** na Task 3 (gewicht/aantal-consolidatie + tests) en laat de pakbon-rijopbouw staan — de duplicatie is dan goedkoper dan het print-regressie-risico (R4).
- **Buiten scope (bewust):** colli-afmetingen-architectuur (analoog C, backlog), elke wijziging aan de fysieke labelformaten/print-CSS, en de carrier-payloads.
```
