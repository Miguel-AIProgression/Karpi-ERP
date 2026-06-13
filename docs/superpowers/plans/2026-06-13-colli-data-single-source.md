# Colli-data single-source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (aanbevolen) of superpowers:executing-plans om dit plan task-voor-task uit te voeren. Stappen gebruiken checkbox (`- [ ]`) syntax voor tracking.

**Goal:** Het "SSCC-patroon" afmaken voor de resterende afgeleide colli-/zending-velden: één canonieke (bevroren) bron per concept, zodat verzendlabel, pakbon, DPD-label en vervoerder-payload niet meer uiteenlopen voor hetzelfde collo. Scope (besluit 2026-06-13): **A1 omschrijving** (kern), **D/E label-fixes**, **A2 gewicht-architectuur** (gecoördineerd). Afmetingen (C) bewust niet — zie de audit.

**Achtergrond:** [2026-06-13-sscc-analogen-audit.md](2026-06-13-sscc-analogen-audit.md) (volledige catalogus + bewijs). Dit plan is het directe vervolg op de SSCC-fix (commit a046e88): label en vervoerder delen al `zending_colli.sscc`; we trekken hetzelfde patroon door naar omschrijving, label-metadata en gewicht.

**Architecture:**
- **A1 (omschrijving):** de print-laag (label/pakbon/DPD) stopt met **live** `order_regels.omschrijving`/`producten.omschrijving` lezen en leest in plaats daarvan de **bevroren** snapshot op `zending_colli`. De bestaande `omschrijving_snapshot` (Karpi-product + maat, via `compose_colli_omschrijving`) blijft wat HST/Verhoek al lezen; we voegen één kolom `klant_omschrijving_snapshot` toe (de ontdubbelde klant-omschrijving die label/pakbon nu apart tonen). De ontdubbel-logica verhuist daarmee van TS (3 varianten: label substring-match, pakbon geen, DPD eigen) naar één SQL-plek (`genereer_zending_colli`). Netto: één bron, één ontdubbeling, geen live-divergentie meer.
- **D/E (label-metadata):** label-datum en -referentie worden onderdeel van de bevroren `LabelItem` (uit `zendingen.verzenddatum` resp. een uniforme order-referentie), zodat een herprint exact toont wat de vervoerder kreeg en alle label-formaten hetzelfde anker gebruiken.
- **A2 (gewicht-architectuur):** alle drie de vervoerders lezen per-colli `zending_colli.gewicht_kg`; een trigger houdt `zendingen.totaal_gewicht_kg = SUM(zending_colli.gewicht_kg)` zodat de HST-fallback nooit meer een afwijkend totaal stuurt. **Niet** de gewicht-data/cache (dat is mig 383, andere agent — zie coördinatie-noot). Verhoek's decagram-conversie blijft (format-eis, geen bron-divergentie).

**Tech Stack:** PostgreSQL/plpgsql (Supabase-migratie), TypeScript/React (frontend print-laag), Deno edge functions (HST-adapter), Vitest (printset/contract-tests). Geen nieuwe dependencies.

**Coördinatie met de gewicht-agent (mig 383):** er draait parallel een agent op [2026-06-12-colli-gewicht-fix.md](2026-06-12-colli-gewicht-fix.md), die `producten.gewicht_kg`, open `order_regels.gewicht_kg` en niet-verzonden `zending_colli.gewicht_kg` **backfillt** en een self-healing trigger zet. Dat plan zegt expliciet: "`zendingen.totaal_gewicht_kg`-backfill bewust NIET in scope". **Slice 4 hieronder raakt uitsluitend `zendingen.totaal_gewicht_kg` (sync-trigger) + de HST-adapter-leeslogica — niet `zending_colli.gewicht_kg` of de producten-cache.** Géén overlap, maar Slice 4 moet ná mig 383 landen (de sync-trigger somt over de dán-correcte colli-gewichten) en het migratienummer moet vlak voor merge afgestemd worden met de gewicht-agent (memory `reference_migratienummer_collisie_bij_merge`).

---

## File-structuur

| Bestand | Actie | Slice | Verantwoordelijkheid |
|---|---|---|---|
| `supabase/migrations/NNN_colli_omschrijving_snapshot.sql` | Create | 1 | `klant_omschrijving_snapshot`-kolom + ontdubbel-SQL in `genereer_zending_colli` + backfill |
| `frontend/src/modules/logistiek/queries/zendingen.ts` | Modify | 2 | print-set fetcht snapshot-velden + `verzenddatum`; types uitgebreid |
| `frontend/src/modules/logistiek/lib/printset.ts` | Modify | 2,3 | `LabelItem` draagt snapshot-omschrijving + datum + referentie |
| `frontend/src/modules/logistiek/lib/shipping-label-data.ts` | Modify | 2,3 | `productNamen` leest snapshot; `datumKort` vervangen door bevroren datum |
| `frontend/src/modules/logistiek/components/shipping-label.tsx` | Modify | 2,3 | leest snapshot-omschrijving + bevroren datum |
| `frontend/src/modules/logistiek/components/shipping-label-tall.tsx` | Modify | 2,3 | idem |
| `frontend/src/modules/logistiek/components/dpd-shipping-label.tsx` | Modify | 2,3 | eigen `omschrijvingVoorRegel` weg; referentie gelijktrekken |
| `frontend/src/modules/logistiek/components/pakbon-document.tsx` | Modify | 2 | `regelNamen` leest snapshot |
| `frontend/src/modules/logistiek/lib/printset.test.ts` | Modify | 2,3 | regressie: snapshot-omschrijving, bevroren datum, referentie-anker |
| `supabase/migrations/MMM_zending_totaal_gewicht_sync.sql` | Create | 4 | trigger `zendingen.totaal_gewicht_kg = SUM(zending_colli.gewicht_kg)` |
| `supabase/functions/hst-send/payload-builder.ts` | Modify | 4 | totaal-gewicht-fallback opschonen (leest gesync'te kolom) |
| `supabase/functions/hst-send/payload-builder.test.ts` | Modify | 4 | test bijwerken |
| `docs/database-schema.md` | Modify | 5 | nieuwe kolom + trigger + comments |
| `docs/changelog.md` | Modify | 5 | entry 2026-06-13 |
| `CLAUDE.md` | Modify | 5 | bedrijfsregel-bullet colli-omschrijving-single-source |

---

### Task 1: Branch + worktree

**Files:** geen (git-setup)

Werkafspraak: substantieel werk meteen in eigen worktree (memory `feedback_worktree_vanaf_start` + `reference_merge_race_parallelle_sessies`). **Let op:** er draait een parallelle gewicht-sessie — werk in een eigen worktree zodat de gedeelde main-tree niet van branch wisselt onder de andere sessie.

- [ ] **Step 1: Worktree + branch**

```powershell
cd C:\Users\migue\Documents\Karpi ERP
git fetch origin; git checkout main; git pull --ff-only
git worktree add C:\Users\migue\Documents\Karpi-ERP-colli-data -b feat/colli-data-single-source
```

- [ ] **Step 2: .env + frontend-deps in de worktree** (memory: Excel/.env ontbreken in worktree; voor frontend-typecheck/tests is `node_modules` nodig)

```powershell
Copy-Item "C:\Users\migue\Documents\Karpi ERP\import\.env" "C:\Users\migue\Documents\Karpi-ERP-colli-data\import\.env" -ErrorAction SilentlyContinue
cd C:\Users\migue\Documents\Karpi-ERP-colli-data\frontend; npm install
```

Verwacht: `git status --porcelain` blijft schoon t.a.v. `.env` (staat in .gitignore).

---

### Task 2 (Slice 1 — A1 DB): omschrijving-snapshot verrijken

**Files:**
- Create: `supabase/migrations/NNN_colli_omschrijving_snapshot.sql` (NNN = eerstvolgende vrije nummer — verifiëren in Task 7; coördineer met de gewicht-agent)

De print-laag toont nu twee dingen die uit **live** order-data komen: de **klant-omschrijving** (`order_regels.omschrijving` + `_2`, met per-document verschillende ontdubbeling) en de **Karpi-product-naam + maat**. De Karpi-naam+maat zit al bevroren in `zending_colli.omschrijving_snapshot` (`compose_colli_omschrijving`, mig 209). Alleen de klant-omschrijving ontbreekt nog als snapshot. We voegen één kolom toe en bevriezen de **ontdubbelde** klant-omschrijving daar — de ontdubbeling verhuist daarmee van 3 TS-varianten naar één SQL-plek.

- [ ] **Step 1: Migratie schrijven**

Structuur:
1. `ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS klant_omschrijving_snapshot TEXT;`
2. Een SQL-helper `compose_klant_omschrijving(p_omschrijving TEXT, p_omschrijving_2 TEXT) RETURNS TEXT` die exact de TS-ontdubbeling van [shipping-label-data.ts:16-23](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts#L16-L23) repliceert: trim beide; laat `omschrijving_2` weg als `LOWER(o1)` de `LOWER(o2)` als substring bevat (`POSITION(LOWER(o2) IN LOWER(o1)) > 0`); anders `o1 || ' ' || o2`; lege delen filteren. **Let op (memory `reference_postgres_woordgrens_regex`):** geen `\b` in regex; deze helper heeft geen regex nodig.
3. `CREATE OR REPLACE FUNCTION genereer_zending_colli(...)` — identiek aan de **laatste** versie (mig 213, of de mig 383-versie als de gewicht-agent die al merged — drift-check in Task 7 Step 0!), met in de `INSERT` één extra waarde: `compose_klant_omschrijving(ore.omschrijving, ore.omschrijving_2)`. Haal `ore.omschrijving, ore.omschrijving_2` mee in de `FOR r IN`-select.
4. Backfill: `UPDATE zending_colli zc SET klant_omschrijving_snapshot = compose_klant_omschrijving(ore.omschrijving, ore.omschrijving_2) FROM zending_regels zr JOIN order_regels ore ON ore.id = zr.order_regel_id JOIN zendingen z ON z.id = zc.zending_id WHERE zc.order_regel_id = ore.id AND z.status NOT IN ('Onderweg','Afgeleverd') AND zc.klant_omschrijving_snapshot IS NULL;` — verzonden/afgeleverde zendingen bewust ongemoeid (historie zoals verzonden).
5. `NOTIFY pgrst, 'reload schema';`

**Conflict-let-op met mig 383:** beide migraties doen `CREATE OR REPLACE FUNCTION genereer_zending_colli`. De laatste die landt wint. Daarom: (a) bouw deze migratie op de **mig 383-body** als die al gemerged is (drift-check), en (b) merge-volgorde afstemmen met de gewicht-agent zodat de winnende versie **beide** wijzigingen bevat (gewicht-ladder + `klant_omschrijving_snapshot`).

- [ ] **Step 2: Syntax-sanity**

```powershell
Select-String -Path supabase\migrations\NNN_colli_omschrijving_snapshot.sql -Pattern '\\b' -SimpleMatch
```
Verwacht: geen hits. Lees de migratie na tegen `docs/database-schema.md` (kolomnamen — de mig 209→213-historie toont dat ongeteste kolomnamen hier de klassieke fout zijn).

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/NNN_colli_omschrijving_snapshot.sql
git commit -m "feat(logistiek): klant_omschrijving_snapshot op zending_colli + ontdubbeling naar SQL (mig NNN)"
```

---

### Task 3 (Slice 1 — A1 frontend): print-laag leest snapshot

**Files:**
- Modify: `frontend/src/modules/logistiek/queries/zendingen.ts`
- Modify: `frontend/src/modules/logistiek/lib/printset.ts`
- Modify: `frontend/src/modules/logistiek/lib/shipping-label-data.ts`
- Modify: `frontend/src/modules/logistiek/components/{shipping-label,shipping-label-tall,dpd-shipping-label,pakbon-document}.tsx`

- [ ] **Step 1: Print-set fetcht de snapshot** — in `fetchZendingPrintSet` ([zendingen.ts:293](../../../frontend/src/modules/logistiek/queries/zendingen.ts#L293)) de `zending_colli`-select uitbreiden naar `( id, colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot )`. `ZendingPrintColli`-interface idem uitbreiden. De live `order_regels`/`producten`-omschrijving-velden mogen blijven staan als legacy-fallback (zending zonder colli), maar zijn niet meer het primaire pad.

- [ ] **Step 2: `LabelItem` draagt de bevroren omschrijving** — in `printset.ts` `LabelItem` uitbreiden met `omschrijvingSnapshot: string | null` en `klantOmschrijvingSnapshot: string | null`. In `expandLabels` (colli-pad) deze uit `c.omschrijving_snapshot` / `c.klant_omschrijving_snapshot` vullen; in het legacy-pad `null` (component valt terug op live `regel`).

- [ ] **Step 3: `productNamen` leest snapshot** — `shipping-label-data.ts` `productNamen` een tweede vorm geven die de snapshot-strings accepteert: `klantNaam = klantOmschrijvingSnapshot`, `karpiNaam = omschrijvingSnapshot` (de product+maat-string). Behoud de live-afleiding alleen als beide snapshots `null` zijn (legacy). De substring-ontdubbeling in TS verdwijnt (zit nu in SQL). Label/tall-componenten roepen `productNamen` aan met de snapshot uit `LabelItem`.

- [ ] **Step 4: DPD-label** — de eigen `omschrijvingVoorRegel` ([dpd-shipping-label.tsx:18-42](../../../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx#L18-L42)) verwijderen en vervangen door dezelfde snapshot-lezing als de andere labels (één bron, geen derde variant).

- [ ] **Step 5: Pakbon** — `regelNamen` ([pakbon-document.tsx:20-28](../../../frontend/src/modules/logistiek/components/pakbon-document.tsx#L20-L28)) laten lezen uit de snapshot. De pakbon itereert per `zending_regel` (order_regel_id); koppel de snapshot via de `zending_colli`-rij met dat `order_regel_id` (eerste colli — in V1 is `compose` regel-deterministisch dus alle colli van een regel zijn identiek). Legacy-fallback naar live blijft. Hiermee verdwijnt ook het ontdubbel-verschil tussen label en pakbon.

- [ ] **Step 6: Typecheck + tests** (memory `reference_pd_branches_typecheck`)

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-colli-data\frontend
npm run typecheck
npx vitest run src/modules/logistiek/lib/printset.test.ts
```

- [ ] **Step 7: Regressietest uitbreiden** — `printset.test.ts`: een colli met `omschrijving_snapshot` + `klant_omschrijving_snapshot` → `expandLabels` levert die door op `LabelItem`; live order_regels-wijziging verandert het label **niet** meer (de regressie die we voorkomen). Plus een legacy-zending zonder colli → val terug op live.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/modules/logistiek
git commit -m "feat(logistiek): label/pakbon/DPD lezen omschrijving uit zending_colli-snapshot (single source)"
```

---

### Task 4 (Slice 2 — D/E): label-datum + referentie bevriezen

**Files:**
- Modify: `frontend/src/modules/logistiek/lib/printset.ts`, `shipping-label-data.ts`, de drie label-componenten, `printset.test.ts`

- [ ] **Step 1: Datum** — `datumKort()` ([shipping-label-data.ts:35-41](../../../frontend/src/modules/logistiek/lib/shipping-label-data.ts#L35-L41)) levert nu de **printdatum** (`new Date()`), waardoor een herprint een andere datum toont dan de vervoerder kreeg. Vervang door de zending-datum: `LabelItem` (of een label-context) draagt `verzenddatum` uit `zendingen.verzenddatum`; compact/tall tonen die i.p.v. `datumKort()`. Het DPD-label doet dit al ([dpd-shipping-label.tsx:127](../../../frontend/src/modules/logistiek/components/dpd-shipping-label.tsx#L127)) — alle drie nu identiek (`verzenddatum ?? created_at`).

- [ ] **Step 2: Referentie** — DPD gebruikt `zending.id` als footer-referentie; compact/tall gebruiken `order.oud_order_nr ?? order.id`. Trek gelijk: alle labels gebruiken hetzelfde anker (`order.oud_order_nr ?? order.order_nr` — de operator-leesbare referentie; `zending.id` is een interne PK en hoort niet op een fysiek label). Eén helper in `printset.ts`/`shipping-label-data.ts`.

- [ ] **Step 3: Test + typecheck + commit**

```powershell
npm run typecheck; npx vitest run src/modules/logistiek/lib/printset.test.ts
git add frontend/src/modules/logistiek
git commit -m "fix(logistiek): label-datum uit verzenddatum + uniforme order-referentie op alle labelformaten"
```

---

### Task 5 (Slice 3 — A2): gewicht-totaal-sync + HST-fallback

> ⚠️ **Coördinatie-gate:** start deze task pas als mig 383 (gewicht-data-fix) is gemerged én toegepast — de sync-trigger somt over de dán-correcte `zending_colli.gewicht_kg`. Stem het migratienummer af met de gewicht-agent.

**Files:**
- Create: `supabase/migrations/MMM_zending_totaal_gewicht_sync.sql`
- Modify: `supabase/functions/hst-send/payload-builder.ts` + `payload-builder.test.ts`

- [ ] **Step 1: Sync-trigger** — migratie met een trigger op `zending_colli` (AFTER INSERT/UPDATE OF gewicht_kg/DELETE) die `zendingen.totaal_gewicht_kg = (SELECT COALESCE(SUM(gewicht_kg),0) FROM zending_colli WHERE zending_id = ...)` zet, plus een eenmalige backfill voor niet-verzonden zendingen. Hiermee is de HST-fallback-bron (`zendingen.totaal_gewicht_kg`) gegarandeerd gelijk aan `SUM(colli)` — geen "twee gewichten voor dezelfde zending" meer. **Niet** `zending_colli.gewicht_kg` zelf aanraken (dat is mig 383). Respecteer de bundel-lock (mig 230): `totaal_gewicht_kg` staat niet in de gelockte kolommenset, dus de trigger mag draaien.

- [ ] **Step 2: HST-adapter** — `payload-builder.ts`: de fallback ([payload-builder.ts:109](../../../supabase/functions/hst-send/payload-builder.ts#L109)) `zending.totaal_gewicht_kg ?? DEFAULT_WEIGHT_KG` is nu betrouwbaar (gesync't). Geen gedragswijziging nodig in het normale (mét-colli) pad — dat leest al per-colli. Documenteer in een comment dat de fallback-bron sinds mig MMM = `SUM(colli)`. Verhoek's decagram-conversie ([xml-builder.ts:24-26](../../../supabase/functions/verhoek-send/xml-builder.ts#L24-L26)) blijft: dat is een format-eenheid, geen bron-divergentie.

- [ ] **Step 3: Test + commit**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-colli-data\supabase\functions\hst-send
deno test
```
```powershell
git add supabase/migrations/MMM_zending_totaal_gewicht_sync.sql supabase/functions/hst-send
git commit -m "fix(logistiek): zendingen.totaal_gewicht_kg = SUM(colli) sync-trigger; HST-fallback consistent (mig MMM)"
```

---

### Task 6 (Slice 4): levende documentatie

**Files:** `docs/database-schema.md`, `docs/changelog.md`, `CLAUDE.md`

- [ ] **Step 1: database-schema.md** — `zending_colli.klant_omschrijving_snapshot`-rij; `compose_klant_omschrijving`-functie; de gewicht-sync-trigger; comment-update op `zendingen.totaal_gewicht_kg` (nu trigger-gesync't).

- [ ] **Step 2: changelog.md** — entry 2026-06-13: het SSCC-patroon doorgetrokken naar omschrijving (label/pakbon/DPD lezen snapshot, ontdubbeling naar SQL), label-datum/referentie bevroren, gewicht-totaal-sync. Verwijs naar de audit.

- [ ] **Step 3: CLAUDE.md** — bedrijfsregel-bullet, in lijn met de bestaande "Verzendlabel-SSCC = `zending_colli.sscc`, één bron"-bullet:

```markdown
- **Colli-omschrijving = `zending_colli`-snapshot, één bron (2026-06-13):** verzendlabel, pakbon en DPD-label lezen de productomschrijving niet meer live uit `order_regels`/`producten` maar uit de bevroren snapshot op `zending_colli` — `omschrijving_snapshot` (Karpi-product + maat, `compose_colli_omschrijving`) + `klant_omschrijving_snapshot` (ontdubbelde `order_regels.omschrijving`+`_2`). De ontdubbeling leeft sinds deze wijziging op één SQL-plek (`compose_klant_omschrijving` in `genereer_zending_colli`), niet meer in 3 TS-varianten (label substring-match, pakbon geen, DPD eigen). Na een productnaamwijziging tonen label, pakbon en vervoerder-payload dus dezelfde tekst. Label-datum komt uit `zendingen.verzenddatum` (niet de printdatum) en alle labelformaten gebruiken dezelfde order-referentie. Gewicht: `zendingen.totaal_gewicht_kg` wordt per trigger gelijk gehouden aan `SUM(zending_colli.gewicht_kg)` zodat de HST-fallback nooit een afwijkend totaal stuurt (de gewicht-DATA-keten zelf = mig 383). Vangnet: `printset.test.ts`. Achtergrond: `docs/superpowers/plans/2026-06-13-sscc-analogen-audit.md`.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/database-schema.md docs/changelog.md CLAUDE.md
git commit -m "docs: colli-omschrijving single-source + label-metadata + gewicht-sync (audit 2026-06-13)"
```

---

### Task 7: Apply + verificatie (samen met Miguel)

**Files:** geen (operationeel draaiboek). Migraties applyt Miguel in de Supabase SQL-editor (memory `reference_karpi_supabase_mcp`).

- [ ] **Step 0: Live-drift-check** — vóór apply, vergelijk de live `genereer_zending_colli`-body met de repo-versie waarop deze migratie is gebouwd:

```sql
SELECT pg_get_functiondef('genereer_zending_colli(bigint)'::regprocedure);
```
Wijkt de body af (bv. de gewicht-agent's mig 383 is al gedraaid) → de migratie eerst herbasen op die body zodat **beide** wijzigingen (gewicht-ladder + `klant_omschrijving_snapshot`) behouden blijven. **Dit is de kritieke coördinatie-stap met de gewicht-sessie.**

- [ ] **Step 1: Mig NNN draaien** (omschrijving-snapshot). Daarna een spot-check: een niet-verzonden zending met meerdere colli → `klant_omschrijving_snapshot` gevuld, gelijk aan de ontdubbelde order-omschrijving.

- [ ] **Step 2: Mig MMM draaien** (gewicht-sync, ná mig 383). Spot-check: `SELECT id, totaal_gewicht_kg, (SELECT SUM(gewicht_kg) FROM zending_colli c WHERE c.zending_id = z.id) FROM zendingen z WHERE status = 'Klaar voor verzending'` → kolommen gelijk.

- [ ] **Step 3: Frontend visuele check** — print een verzendset (label + pakbon) van een bestaande niet-verzonden zending; bevestig dat omschrijving, datum en referentie kloppen en label==pakbon==vervoerder. Wijzig daarna `order_regels.omschrijving` op een open testorder en herprint → label verandert **niet** (snapshot bevroren); bevestigt de fix.

- [ ] **Step 4: Edge function deploy** (HST-adapter, alleen comment-wijziging — geen gedrag): `supabase functions deploy hst-send --project-ref wqzeevfobwauxkalagtn`.

---

### Task 8: Afronden — typecheck, merge-voorbereiding

- [ ] **Step 1: Full typecheck + logistiek-tests**

```powershell
cd C:\Users\migue\Documents\Karpi-ERP-colli-data\frontend; npm run typecheck; npx vitest run src/modules/logistiek
```

- [ ] **Step 2: Migratienummer-hercheck vlak vóór merge** (memory `reference_migratienummer_collisie_bij_merge` — kritiek door de parallelle gewicht-sessie):

```powershell
git fetch origin; git ls-tree origin/main --name-only supabase/migrations/ | Select-String 'NNN|MMM'
```
Botsing → hernummeren naar het eerstvolgende vrije nummer + header-notitie.

- [ ] **Step 3: Branch pushen; merge naar main pas op Miguels expliciete commando** via `git push origin feat/colli-data-single-source:main` (memory `reference_merge_race_parallelle_sessies`). Stem de merge-volgorde af met de gewicht-agent (mig 383 eerst, dan deze).

- [ ] **Step 4: Worktree opruimen** na merge: `git worktree remove C:\Users\migue\Documents\Karpi-ERP-colli-data`.

---

## Risico's & rollback

- **Snapshot-verarming op het label:** de nieuwe label-weergave toont de **bevroren** product+maat-string (`compose_colli_omschrijving`) i.p.v. de live aparte karpiNaam + maat-regel. Voor maatwerk en vaste maten bevat compose beide, dus geen informatieverlies; wel een lichte layout-verandering (maat inline i.p.v. aparte regel). Bewuste keuze — de compose-string is de canonieke productweergave die ook de vervoerder krijgt. Bij bezwaar: de losse `productMaat`-regel kan teruggehaald worden door een `maat_snapshot`-kolom toe te voegen (uitbreiding, niet nodig voor V1).
- **Legacy-zendingen zonder colli:** vallen terug op de live order_regels-afleiding (zoals het SSCC-legacy-pad). Bewust — bestaande/verzonden zendingen blijven tonen zoals ze de deur uit gingen.
- **`genereer_zending_colli`-conflict met mig 383:** beide migraties vervangen de functie. Mitigatie: drift-check (Task 7 Step 0) + merge-volgorde afstemmen; de winnende versie moet beide wijzigingen bevatten. Dit is het grootste coördinatie-risico.
- **Gewicht-sync-trigger draait vóór mig 383:** dan somt hij over nog-rotte colli-gewichten. Mitigatie: de coördinatie-gate op Task 5 + apply-volgorde in Task 7 (mig 383 eerst).
- **Geen gedragswijziging voor HST/Rhenus/Verhoek-payload-shape:** alleen de omschrijving wordt consistenter en het totaal-gewicht betrouwbaarder; veldnamen/structuur ongewijzigd.
