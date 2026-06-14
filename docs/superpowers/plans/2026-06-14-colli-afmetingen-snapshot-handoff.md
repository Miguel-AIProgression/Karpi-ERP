# Handoff — Colli-afmetingen in de `zending_colli`-snapshot (candidate #2)

**Datum:** 2026-06-14
**Voor:** een verse agent die dit zelfstandig oplost
**Type:** verticale slice (DB-migratie → 2 edge-function-orchestrators → tests)
**Status:** nog niet begonnen — dit is een opdracht-handoff, geen voortzetting

## Eén zin

Trek `lengte_cm`/`breedte_cm` in dezelfde **bevroren** `zending_colli`-snapshot als
`gewicht_kg` en de omschrijvingen, zodat `verhoek-send` en `rhenus-send` de
colli-rij lézen i.p.v. elk een eigen handgespiegelde `maatwerk → product`-ladder
live op te halen.

## Waarom (de smell)

Asymmetrie. `zending_colli.gewicht_kg` is een bevroren snapshot (mig 387) en álle
carriers lezen dezelfde rij — single source. Maar `lengte_cm`/`breedte_cm` staan
**niet** op `zending_colli`; Verhoek en Rhenus halen ze live op via een
hand-gekopieerde ladder `order_regels.maatwerk_*_cm ?? producten.*_cm`. Dat zijn
**twee adapters met dezelfde ladder = een echte seam die nog niet bestaat**:

- Wijzig je de ladder ooit (bv. SKU-override), dan moet je 3 plekken raken
  (`genereer_zending_colli` + beide orchestrators) en is "één vergeten" een
  stille divergentie tussen wat het label/pakbon toont en wat de vervoerder als
  afmeting krijgt.
- Bij een live productnaam/maat-wijziging kan een carrier een **andere** afmeting
  versturen dan de bevroren colli (label/pakbon lezen al snapshots; de carriers
  niet voor dims).

Dit is exact het patroon dat we net voor de barcode (candidate #1) en eerder voor
gewicht (mig 387) en omschrijving (mig 390) hebben dichtgetrokken. Zelfde
oplossing: één canonieke bevroren bron op `zending_colli`.

## Wat al gedaan is in deze sessie (context, NIET deze taak)

Candidate #1 (de zustertaak) is **af, getest en gedeployed**: de AI(00)-barcode-
encoding leeft nu op één plek (`labelBarcode()` in
`supabase/functions/_shared/vervoerders/labelbarcode.ts`). Branch
`feat/labelbarcode-ssot` (worktree `.worktrees/labelbarcode-ssot`), commit
`3e2fdc3`, nog **niet gemerged** naar main. Edge functions `hst-send`/`verhoek-send`/
`rhenus-send` zijn vanuit die branch gedeployed. Zie `docs/changelog.md`
(2026-06-14) en de CLAUDE.md-notitie "Labelbarcode-encoding = één seam".

→ **Candidate #2 (deze handoff) is onafhankelijk** van die branch: andere
bestanden, geen overlap. Begin op een **verse branch/worktree vanaf `origin/main`**
(niet vanaf `feat/labelbarcode-ssot`). Conform CLAUDE.md git-workflow:
substantieel werk = eigen branch, merge pas op expliciet commando van Miguel.

## Exacte ankerpunten

### 1. De single insert-plek (SQL)
`supabase/migrations/390_colli_omschrijving_snapshot.sql` → functie
`genereer_zending_colli(p_zending_id BIGINT)`. **Dit is de superset-functie**
(gewicht-ladder mig 387 + klant-omschrijving mig 390). De loop-record `r` rekent
`maatwerk_lengte_cm`, `maatwerk_breedte_cm`, `prod_lengte_cm`, `prod_breedte_cm`
**al uit** — maar gebruikt ze alleen voor `compose_colli_omschrijving`, niet als
eigen kolom. De `INSERT INTO zending_colli (...)` kolomlijst is nu:
`zending_id, colli_nr, order_regel_id, rol_id, sscc, gewicht_kg,
omschrijving_snapshot, klant_omschrijving_snapshot, aantal`.

### 2. De tabel
`supabase/migrations/209_zending_colli_sscc.sql` → `CREATE TABLE zending_colli`.
Heeft `gewicht_kg NUMERIC`, `omschrijving_snapshot TEXT`, géén `lengte_cm`/
`breedte_cm`.

### 3. De twee carrier-ladders (die straks de kolom lezen i.p.v. de join)
- `supabase/functions/rhenus-send/index.ts` — query met FK-hint-join
  `order_regels:order_regel_id ( maatwerk_lengte_cm, maatwerk_breedte_cm,
  producten:order_regels_artikelnr_fkey ( lengte_cm, breedte_cm ) )` →
  mapping `lengte_cm: r.order_regels?.maatwerk_lengte_cm ??
  r.order_regels?.producten?.lengte_cm ?? null` (idem breedte).
- `supabase/functions/verhoek-send/index.ts` — **identieke** ladder (regels ~159-176).
- De colli-input-types (`RhenusColliInput`, `VerhoekColliInput`) houden
  `lengte_cm`/`breedte_cm` — alleen de **bron** verandert (kolom i.p.v. join). De
  pure xml-builders + hun tests blijven dus ongemoeid.
- **HST raakt dit niet:** `hst-send/payload-builder.ts` gebruikt geen per-colli
  dims maar `DEFAULT_*` uit de capability-descriptor. Buiten scope.

## Voorgestelde aanpak (verticale slice)

1. **DB-migratie** (nieuw nummer — zie valkuil hieronder):
   - `ALTER TABLE zending_colli ADD COLUMN IF NOT EXISTS lengte_cm INTEGER`,
     idem `breedte_cm INTEGER` (+ `COMMENT`). INTEGER want de ladder rondt al af
     (`::INTEGER` in de record; Rhenus deed `Math.round`).
   - `CREATE OR REPLACE FUNCTION genereer_zending_colli` — **superset van mig 390**:
     neem de hele mig-390-body over en voeg in de INSERT twee kolommen +
     waarden toe:
     `lengte_cm = COALESCE(r.maatwerk_lengte_cm, r.prod_lengte_cm)`,
     `breedte_cm = COALESCE(r.maatwerk_breedte_cm, r.prod_breedte_cm)`.
     (= exact de carrier-ladder, nu in SQL.)
   - **Backfill** voor niet-verzonden zendingen, zelfde guard als mig 390 §4
     (`z.status NOT IN ('Onderweg','Afgeleverd')`, `WHERE lengte_cm IS NULL`).
   - Verifier-`DO`-block + `NOTIFY pgrst, 'reload schema'` (mirror mig 390).
2. **Orchestrators** (`rhenus-send/index.ts` + `verhoek-send/index.ts`): vervang
   de FK-hint-join in de `zending_colli`-select door directe kolommen
   `lengte_cm, breedte_cm`; mapping wordt `lengte_cm: r.lengte_cm`. De
   `order_regels`-join is daarna alleen nog nodig voor wat de carrier verder leest
   (Verhoek: `artikelnr` — check of die join nog ergens voor dient; Rhenus: niets
   meer → join kan weg).
3. **Tests:** `frontend/.../printset.test.ts` dekt al de snapshot-velden — voeg
   lengte/breedte toe aan dat vangnet. De carrier-xml-builder-tests blijven groen
   (builder-input ongewijzigd). Draai `deno test` op beide carriers +
   `npm run typecheck` in `frontend/`.
4. **Docs (verplicht, CLAUDE.md):** `database-schema.md` (nieuwe kolommen),
   `changelog.md`, en de CLAUDE.md-bullet "Colli-omschrijving = `zending_colli`-
   snapshot" uitbreiden naar "omschrijving + afmetingen". Overweeg de
   gewicht-keten-bullet te laten verwijzen.

## Valkuilen (uit het projectgeheugen)

- **mig-390-superset-drift:** mig 390's eigen comment waarschuwt dat
  `genereer_zending_colli` een superset is van mig 387. Jouw nieuwe migratie doet
  **opnieuw** `CREATE OR REPLACE` → je body moet de **complete** mig-390-body zijn
  + jouw 2 kolommen. Mis je iets, dan verlies je gewicht-ladder of
  klant-omschrijving. Verifieer met `pg_get_functiondef` ná apply.
- **Migratienummer-collisie:** kies het nummer **vlak vóór merge** opnieuw t.o.v.
  `origin/main` (parallelle sessies claimen nummers; recent meerdere collisies).
  De repo zit rond 397; check de hoogste op `origin/main` op het moment van merge.
- **Migraties handmatig toepassen:** `supabase db push` is gevaarlijk hier;
  migraties worden met de hand op de live DB gedraaid (zie geheugen
  `reference_karpi_supabase_mcp`). Edge-deploy:
  `supabase functions deploy <naam> --project-ref wqzeevfobwauxkalagtn`.
- **Worktree mist deps:** verse worktree heeft geen `node_modules` → `npm ci` in
  `frontend/` vóór typecheck; `.env`/Excel-bronnen ontbreken ook.
- **PS 5.1 mojibake:** tekstvervangingen via de Edit-tool, niet via
  `Get-Content`/`-replace` (verminkt BOM-loos UTF-8).

## Buiten scope (bewust)

- HST per-colli dims (gebruikt defaults — apart vraagstuk).
- Colli-afmetingen wijzigen ná aanmaak (snapshot is bewust bevroren, net als
  gewicht/omschrijving).
- De orchestrator-loop-generalisatie (ADR-0032 §5, eigen backlog-item).

## Skills voor de volgende sessie

- `superpowers:using-git-worktrees` — verse worktree vanaf `origin/main`.
- `superpowers:test-driven-development` of `tdd` — snapshot-vangnet eerst.
- `superpowers:verification-before-completion` — deno + typecheck + pg_get_functiondef-drift-check vóór "klaar".
- Eventueel `code-review` / een `code-reviewer`-subagent op de migratie (superset-drift is de hoofdrisico).

## Referenties

- Architectuur-review die deze kandidaat opleverde: deze sessie (candidate #2).
- Zuster-fix (candidate #1, het patroon om te volgen): `docs/changelog.md`
  2026-06-14 + commit `3e2fdc3` op `feat/labelbarcode-ssot`.
- Snapshot-precedenten: mig 387 (gewicht), mig 390 (omschrijving),
  `docs/superpowers/plans/2026-06-13-sscc-analogen-audit.md` (noemt
  colli-afmetingen al expliciet als open punt).
