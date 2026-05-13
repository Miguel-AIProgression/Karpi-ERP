---
status: accepted
date: 2026-05-13
---

# Admin-pseudo-orderregel als data-driven concept — `producten.is_pseudo` als bron-van-waarheid, géén TS-spiegel

## Context

Sinds mig 256 (BUNDELKORTING 2-regel-vorm op factuur) zijn er drie artikelnrs die geen fysiek leverbaar product representeren maar een administratieve correctie op de factuur:

- `VERZEND` — per-order verzendkosten-regel (al lang in gebruik, sinds mig 117)
- `BUNDELKORTING` — tegenboeking bij bundel-zending (mig 256-262 V2 layout)
- `DREMPELKORTING` — cadeau bij `gratis_drempel`-status (mig 256-262 V2 layout)

Deze "admin-pseudo's" hebben geen voorraad-allocatie, geen IO-claim-keten en geen levertijd-relatie. Ze moeten daarom overal worden uitgesloten waar een orderregel anders een voorraad-/IO-/levertijd-mutatie zou triggeren.

### Sprawl — 15+ callsites met hardcoded string-lijsten

**SQL (10 migraties):**
- [mig 263](../../supabase/migrations/263_claims_skip_admin_artikelnrs.sql) — `herwaardeer_claims_voor_order` skipt de 3 strings
- [mig 266](../../supabase/migrations/266_orderregel_trigger_skip_admin.sql) — `trg_orderregel_herallocateer` filter
- [mig 269](../../supabase/migrations/269_admin_pseudos_skip_status_en_levertijd.sql) — `herbereken_wacht_status` + view `order_regel_levertijd` filter
- mig 206, 211, 217, 218, 219, 221, 225, 227, 229, 232, 234, 256, 260-265, 268 — overige callsites die VERZEND of varianten hardcoderen

**FE (5 callsites — alleen `VERZEND` via `SHIPPING_PRODUCT_ID`):**
- [`modules/magazijn/queries/pickbaarheid.ts:179`](../../frontend/src/modules/magazijn/queries/pickbaarheid.ts#L179)
- [`modules/reserveringen/lib/dekking-preview.ts:25`](../../frontend/src/modules/reserveringen/lib/dekking-preview.ts#L25)
- [`modules/logistiek/lib/is-shipping-regel.ts:14`](../../frontend/src/modules/logistiek/lib/is-shipping-regel.ts#L14)
- [`lib/orders/order-afleverdatum.ts:28`](../../frontend/src/lib/orders/order-afleverdatum.ts#L28)
- [`components/orders/article-selector.tsx:53`](../../frontend/src/components/orders/article-selector.tsx#L53)

### Symmetrie-bedrijfsregel in CLAUDE.md

Sinds de N²-recursiebug van 2026-05-13 (zie [`docs/superpowers/plans/2026-05-13-vervolg-orderregel-mirror-recursiebug.md`](../superpowers/plans/2026-05-13-vervolg-orderregel-mirror-recursiebug.md)) bevat CLAUDE.md een expliciete bedrijfsregel:

> **Admin-pseudo-orderregels symmetrisch overslaan (mig 263 / 266 / 269):** … Drie plekken moeten ze identiek filteren … Nieuwe admin-pseudo toevoegen → uitbreiden op álle drie. Anders trekt de regel óf de order-status onterecht naar `Wacht op voorraad` óf de regel-badge naar `wacht_op_nieuwe_inkoop`.

Dat is de samenvatting van het probleem: drie SQL-plekken + vijf FE-plekken kennen elk *een eigen kopie* van een 3-strings-lijst, en de bedrijfsregel zegt "succes met grep-en-pray". Bij mig 263 → mig 266 → mig 269 is exact dit driemaal achter elkaar aan-gefikst.

### FE/SQL-divergentie

Een belangrijke observatie: SQL filtert *alle drie* strings; FE filtert alleen `VERZEND`. Dat is geen feature — het is een artefact van de huidige praktijk waarin BUNDELKORTING en DREMPELKORTING **niet bestaan als orderregel** (mig 262 zet de orderregel-mirror uit wegens de recursie-bug). De SQL is defensief voor het hypothetische geval dat de mirror ooit terug-aangezet wordt; de FE heeft daar geen weet van.

### Deletion test

Verwijder álle 15+ hardcoded string-lijsten en checks. Vijftien callsites willen één vraag beantwoord zien: *"is deze orderregel een administratieve correctie zonder fysieke leverbaarheid?"* Het concept bestond impliciet in vijftien kopieën van dezelfde lijst. **Complexiteit concentreert** op één predikaat + één data-veld.

## Beslissing

Vier samenhangende ingrepen, big-bang in één PR (conform feedback-memory "ADR + alle stappen in één commit").

### Ingreep 1 — `producten.is_pseudo BOOLEAN` als bron-van-waarheid

Voeg een kolom toe op `producten`. Geen aparte tabel, geen ENUM-categorie — de drie pseudo's zijn al producten (mig 265). Backfill voor de bestaande drie, default FALSE voor alle andere.

```sql
ALTER TABLE producten
  ADD COLUMN is_pseudo BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE producten SET is_pseudo = TRUE
  WHERE artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');
CREATE INDEX producten_is_pseudo_idx ON producten(is_pseudo) WHERE is_pseudo;
```

Een toekomstige 4e/5e admin-pseudo (bijv. `STAAL`, `MONSTER`, `ADMINFEE`) is dan een pure `INSERT INTO producten (..., is_pseudo) VALUES (..., TRUE)` — geen code-edit, geen redeploy.

### Ingreep 2 — SQL helper-functie `is_admin_pseudo(text)`

Voor SQL-queries die geen JOIN op `producten` doen:

```sql
CREATE OR REPLACE FUNCTION is_admin_pseudo(p_artikelnr TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(
      (SELECT is_pseudo FROM producten WHERE artikelnr = p_artikelnr),
      FALSE
    )
  $$;
```

`STABLE` (niet `IMMUTABLE`) omdat de set kan wijzigen tussen statements; `PARALLEL SAFE` zodat de view-planner 'm kan vectoriseren. De 10 SQL-callsites (`263/266/269` + 7 anderen) vervangen hun hardcoded `artikelnr IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')` door `is_admin_pseudo(artikelnr)`. Geen gedragsverandering — alleen abstractie.

### Ingreep 3 — FE: `is_pseudo` reist mee in queries; géén TS-spiegel

FE-queries die orderregels lezen breiden hun `select(...)` uit met `producten ( is_pseudo )`. De Supabase-types pakken het automatisch op (gegenereerd schema).

```ts
// modules/orders/lib/admin-pseudo.ts (nieuwe locatie)
import type { OrderRegelMetProduct } from '@/modules/orders/types'

export function isAdminPseudo(regel: { producten?: { is_pseudo?: boolean | null } | null }): boolean {
  return regel.producten?.is_pseudo === true
}
```

De 5 FE-callsites consumeren `isAdminPseudo(regel)` met een regel-object — geen hardcoded artikelnr-strings meer.

### Ingreep 4 — `SHIPPING_PRODUCT_ID` blijft, met expliciete scope-comment

```ts
// frontend/src/lib/constants/shipping.ts
// LET OP: deze constant bedient ALLEEN de TOE-VOEG-semantiek
// (applyShippingLogic maakt een nieuwe verzendregel met deze artikelnr).
// Voor SKIP-detectie van admin-pseudo's: gebruik isAdminPseudo(regel)
// uit modules/orders/lib/admin-pseudo.ts — niet deze constant.
export const SHIPPING_PRODUCT_ID = 'VERZEND'
```

Toe-voegen is iets fundamenteel anders dan skippen. `applyShippingLogic` heeft een vaste artikelnr nodig om een nieuwe regel te construeren; de constant blijft daar terecht.

### Ingreep 5 — Lint-script + ESLint-regel

```bash
# scripts/lint-no-hardcoded-admin-pseudo-strings.sh
# Greept naar 'VERZEND' | 'BUNDELKORTING' | 'DREMPELKORTING' in
# .sql/.ts/.tsx buiten de whitelist (mig 265 voor seed, de SHIPPING_
# PRODUCT_ID-constant, de admin-pseudo.ts-helper zelf).
```

ESLint `no-restricted-syntax` voor literal `'BUNDELKORTING'`/`'DREMPELKORTING'` strings in `frontend/src/` met bypass-comment-mechanisme voor uitzonderingsgevallen.

## Module-Interface

**Niet** een eigen `modules/admin-pseudo/` — overkill voor één boolean. Het concept leeft als:

- **DB-bron**: `producten.is_pseudo` (data)
- **SQL-helper**: `is_admin_pseudo(artikelnr)` (convenience voor join-loze queries)
- **TS-helper**: `isAdminPseudo(regel)` in [`modules/orders/lib/admin-pseudo.ts`](../../frontend/src/modules/orders/lib/admin-pseudo.ts) (de toekomstige Order-Voorstel-Module zal deze map al bezitten; tot die tijd staat hij in `lib/orders/admin-pseudo.ts`)

Geen contract-test nodig — er is geen tweede bron om tegen te vergelijken. De boolean reist met de data; drift is onmogelijk.

## Migratiepad (big-bang, één PR)

1. **Stap 1 — Mig 272 (SQL):** `ALTER TABLE producten ADD COLUMN is_pseudo` + backfill + index + `is_admin_pseudo(text)`-functie.
2. **Stap 2 — SQL-callsites (mig 273):** herschrijf de tekstfilters in mig 263/266/269 + de 7 overige hardcoded callsites naar `is_admin_pseudo(artikelnr)`. Pure refactor, geen gedragsverandering. Asserties in een `DO $$ BEGIN ASSERT … END $$`-blok onderaan de migratie tegen vooraf-gemeten waarden.
3. **Stap 3 — FE-types:** breid Supabase-types uit (`supabase gen types` of handmatig zolang er geen MCP-toegang is). 10 query-bestanden krijgen `is_pseudo` in hun `select(...)`.
4. **Stap 4 — FE-helper:** maak [`frontend/src/lib/orders/admin-pseudo.ts`](../../frontend/src/lib/orders/admin-pseudo.ts) met `isAdminPseudo(regel)`. Twee unit-tests (regel met `is_pseudo=true` → true; null → false).
5. **Stap 5 — FE-callsites:** 5 callsites omzetten naar `isAdminPseudo(regel)`. Verwijder hardcoded `artikelnr === SHIPPING_PRODUCT_ID`-checks in **skip**-context (laat 'm staan in **toe-voeg**-context).
6. **Stap 6 — `SHIPPING_PRODUCT_ID` scope-comment:** voeg de "LET OP"-block toe; bevestig dat alle resterende callers in toe-voeg-context staan.
7. **Stap 7 — Lint:** `scripts/lint-no-hardcoded-admin-pseudo-strings.sh` + pre-commit-hook of CI-stap. ESLint `no-restricted-syntax` voor de twee korting-strings.
8. **Stap 8 — Docs:** [`data-woordenboek.md`](../data-woordenboek.md) (term al toegevoegd in deze ADR-PR), [`architectuur.md`](../architectuur.md) (kort verwijzen), [`changelog.md`](../changelog.md).
9. **Stap 9 — Update CLAUDE.md-bedrijfsregel:** vervang de "drie plekken moeten ze identiek filteren"-tekst door "gebruik `is_admin_pseudo()` / `isAdminPseudo(regel)`; nieuwe admin-pseudo = pure `producten.is_pseudo=TRUE` INSERT".

## Overwogen alternatieven

- **TS-constant + Vitest contract-test (ADR-0015-pattern).** Afgewezen op gebruikersverzoek 2026-05-13: hardcoded TS-strings blijven een tweede bron die kan afwijken; admin moet (theoretisch) een pseudo kunnen toevoegen zonder code-edit. Contract-test vangt drift wel, maar voorkomt 'm niet — en de admin-UI-route was de doorslaggevende reden.

- **Bootstrap-fetch met module-state.** Afgewezen omdat early-callers (vroeg in app-init, SSR, tests) een falsy resultaat zouden krijgen voor de Set was geladen. Te veel impliciete volgordevereisten.

- **Gecodegenereerde TS-constant uit DB-seed.** Afgewezen wegens build-stap DB-dependency: lokale dev zonder DB-toegang zou stuk gaan. Plus: nog steeds een tweede bron die kan divergeren tussen generaties.

- **Aparte tabel `admin_pseudo_artikelnrs(artikelnr PK, categorie, reden)`.** Afgewezen: overkill voor 3 strings; categorie-veld zou pas waarde bieden bij 6+ pseudo's met semantische groepen ("verzendkosten" vs "korting") — speculation nu. Als die behoefte ontstaat (bv. om aparte UI-treatments te onderbouwen), is een latere ALTER TABLE een kleinere stap dan het concept nu te overengineeren.

- **Twee aparte predikaten: `is_shipping_regel` + `is_admin_pseudo`.** Afgewezen: bewaart de huidige FE/SQL-divergentie als feature. De divergentie is een artefact, geen ontwerpkeuze. Defensief alle 3 skippen op FE is gratis correctheid voor het scenario dat de orderregel-mirror ooit terug-aangezet wordt.

- **Eigen `modules/admin-pseudo/`-folder.** Afgewezen als overengineering. Eén boolean + één helper + één SQL-functie rechtvaardigen geen Module-barrel. De helper hoort in `lib/orders/` (later: `modules/orders/lib/`).

## Consequenties

**Positief:**
- Eén edit (`UPDATE producten SET is_pseudo=TRUE`) propageert naar alle 15+ callsites.
- Geen TS↔SQL contract-drift mogelijk; boolean reist met data.
- CLAUDE.md "Admin-pseudo-orderregels symmetrisch overslaan"-bedrijfsregel verschrompelt van "drie plekken handmatig uitbreiden" naar "set is_pseudo=TRUE; that's it".
- De recursie-bug die op 2026-05-13 drie keer achter elkaar gefikst moest worden (mig 263 → 266 → 269) wordt categorisch onmogelijk — er is geen lijst meer om uit te breiden.

**Negatief / risico's:**
- 10 FE-queries krijgen een extra veld in hun `select(...)`. Marginale payload-toename per response.
- Bestaande FE-types worden breder; sommige consumenten moeten hun shape-types aanpassen. Typescript-compile vangt het.
- `SHIPPING_PRODUCT_ID = 'VERZEND'` blijft als hardcoded string in één plek — dat is de toe-voeg-semantiek en de scope-comment maakt het expliciet. Een toekomstige refactor zou ook *toe-voegen* data-driven kunnen maken (bv. `producten` met flag `is_default_shipping=TRUE`), maar dat is buiten scope.

## Implementatie

Zie [`docs/superpowers/plans/2026-05-13-admin-pseudo-data-driven.md`](../superpowers/plans/2026-05-13-admin-pseudo-data-driven.md).
