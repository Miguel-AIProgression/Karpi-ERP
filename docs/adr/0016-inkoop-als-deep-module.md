---
status: accepted
date: 2026-05-13
---

# Inkoop als deep Module — RPC-renames voor ontvangst, slot-pattern naar Reservering

## Context

Het **Inkooporder**-concept staat eerstegraads in [`data-woordenboek.md`](../data-woordenboek.md): tabel `inkooporders` (kop) + `inkooporder_regels` (regels) representeren bestellingen bij leveranciers (rollen-pad én vaste-maten-stuks-pad). Sinds mig 144 zijn IO-regels óók een tweede claim-bron voor Reservering (rij `bron='inkooporder'` in `order_reserveringen`). Inkoop voldoet aan alle eisen voor een diepe verticale Module — alleen heeft het er geen.

### Sprawl backend

De RPC's en triggers leven verspreid over zeven migraties:

- mig 127 — basis tabellen `inkooporders`, `inkooporder_regels`, `leveranciers`, ENUM `inkooporder_status`
- mig 128 — unique-indexes fix (artikelnr + io_nr)
- mig 129 — legacy-kolommen nullable
- mig 131-132 — dubbele FK's opruimen
- mig 133-136 — `boek_ontvangst` (rollen-pad): voltooien van een IO-regel die als type='rol' is geboekt, auto-rolnummer, `voorraad_mutaties`-INSERT, schema-fixes
- mig 137 — `besteld_per_kwaliteit_kleur` (read-only aggregaat-view)
- mig 148 — `boek_voorraad_ontvangst` consumeert claims (stuks-pad voor vaste maten)
- mig 254 — Reservering-Module-split: `boek_io_ontvangst_claims` als publieke RPC; `boek_voorraad_ontvangst` roept hem aan via `PERFORM`
- mig 255 — IO-release-trigger op `order_events`

Twee parallelle ontvangst-paden — `boek_voorraad_ontvangst` (stuks) en `boek_ontvangst` (rollen) — delen geen naam-prefix, geen documentatie, geen contract-test. Naming-asymmetrie verraadt dat ze los van elkaar gegroeid zijn. ADR-0015 heeft `boek_io_ontvangst_claims` al naar Reservering verhuisd; wat overblijft binnen Inkoop is rol-creatie + voorraad-mutatie-INSERT + IO-regel-status-update.

### Sprawl frontend

- [`lib/supabase/queries/inkooporders.ts`](../../frontend/src/lib/supabase/queries/inkooporders.ts) — **543 regels** (boven de 300-grens van de project-conventie)
- [`lib/supabase/queries/leveranciers.ts`](../../frontend/src/lib/supabase/queries/leveranciers.ts) — 97 regels
- [`components/inkooporders/`](../../frontend/src/components/inkooporders/) — 6 bestanden: `inkooporder-form-dialog`, `inkooporder-status-badge`, `ontvangst-boeken-dialog`, `io-regel-claims-popover`, `voorraad-ontvangst-dialog`, `rol-sticker-layout`
- [`pages/inkooporders/`](../../frontend/src/pages/inkooporders/) — 3 bestanden: overview, detail, rol-stickers-print
- [`pages/leveranciers/`](../../frontend/src/pages/leveranciers/) — 2 bestanden: overview, detail
- [`import/import_inkoopoverzicht.py`](../../import/import_inkoopoverzicht.py) — Excel-import die direct tabelschrijfacties doet via service-role-key, RLS bypass'end

Importeert vanuit `components/inkooporders/`, `pages/inkooporders/`, `pages/leveranciers/`, `lib/supabase/queries/` — vier folders voor één concept, plus een Python-script dat de hele RLS-laag omzeilt.

### Deletion test

Verwijder de twee ontvangst-RPC's en de IO-regel-CRUD-mutations: ontvangst-flow, voorraad-stand voor vaste maten, rol-creatie, en levertijd-belofte (Reservering depends-on IO-regels) breken samen door. Negen-plus callsites in front- en backend muteren of lezen `inkooporders`/`inkooporder_regels` direct. De Module **verdient** depth.

## Beslissing

Vier ingrepen.

### Ingreep 1 — Maak `modules/inkoop/` als deep verticale Module (medium scope)

Folder `modules/inkoop/`, term **Inkoop-Module**, naam DB-aligned (tabel `inkooporders`, maar de Module bezit óók `leveranciers` en de ontvangst-RPC's — "Inkoop" is de juiste concept-naam, niet "Inkooporders"). Glossary-term **Inkooporder** blijft voor de kop-instantie, **IO-regel** voor de regel.

**Scope (volgt Snijplanning- en Reservering-precedent):** logica-laag + 6 components + 5 pages verhuizen. Medium scope.

De Module bezit:
- **Queries** voor `inkooporders`-list/detail, `inkooporder_regels` per IO, `leveranciers`-list/detail, `leverancier_stats` (toekomstige aggregaat-RPC)
- **Mutations** via RPC-wrappers voor `create_inkooporder` (Python-import-vervanger, vervolg-werk), `update_inkooporder`, `boek_inkooporder_ontvangst_stuks` (gerenamed), `boek_inkooporder_ontvangst_rollen` (gerenamed)
- **Components** `InkooporderFormDialog`, `InkooporderStatusBadge`, `OntvangstBoekenDialog`, `IORegelClaimsPopover`, `VoorraadOntvangstDialog`, `RolStickerLayout`, `LeverancierStatsCard` (nieuw)
- **Slot-component** `InkoopRegelSamenvatting` — geleverd aan Reservering's `RegelClaimDetail` om de IO-regel-samenvatting (artikelnr, leverancier, verwacht_datum, IO-nr-link) inline te tonen zonder dat Reservering import-pad naar Inkoop nodig heeft
- **Pages** `InkooporderOverview`, `InkooporderDetail`, `RolStickersPrint`, `LeverancierOverview`, `LeverancierDetail`
- **Cache.ts** met `invalidateNaInkoopMutatie(qc, { isOntvangst? })`

De Module bezit **niet**:
- **`boek_io_ontvangst_claims`** — Reservering's bezit sinds mig 254. Inkoop's ontvangst-RPC's roepen hem aan via `PERFORM`, niet andersom
- **Rol-creatie + `voorraad_mutaties`-INSERT** — concept-eigenaar is een toekomstige Voorraad/Producten-Module. Tijdelijk geparkeerd binnen Inkoop's rollen-pad-RPC met TODO-comment, eigenaar wordt later expliciet toegekend
- **Inkoopgroepen** — ondanks de naam een klant-attribuut (mig 189: `debiteuren.inkoopgroep_code`). Hoort thuis in Debiteur-Module (kandidaat #5)
- **`besteld_per_kwaliteit_kleur`-view** (mig 137) — read-only aggregaat dat Voorraadpositie consumeert; eigenaar wordt Voorraad/Producten-Module zodra die bestaat

### Ingreep 2 — Mig 257: pure RPC-rename, naming-symmetrie

`boek_voorraad_ontvangst` en `boek_ontvangst` hebben asymmetrische namen — de eerste klinkt als een voorraad-RPC, de tweede generiek. Beide zijn IO-ontvangst-paden. Hernoem in mig 257:

```sql
-- Stuks-pad (vaste maten):
boek_voorraad_ontvangst → boek_inkooporder_ontvangst_stuks

-- Rollen-pad:
boek_ontvangst → boek_inkooporder_ontvangst_rollen
```

**Pure rename** — de body komt 1-op-1 over van mig 254 (`boek_voorraad_ontvangst` met `PERFORM boek_io_ontvangst_claims(...)`) resp. mig 133-136 (`boek_ontvangst`). Geen body-herschrijving in deze migratie; refactor blijft een aparte stap.

Backward compat: de oude namen blijven bestaan als **DEPRECATED thin wrappers** voor één release, conform ADR-0015's pattern voor `herwaardeer_order_status`:

```sql
CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(...)
RETURNS ... AS $$
  -- DEPRECATED (mig 257, ADR-0016): gebruik boek_inkooporder_ontvangst_stuks.
  -- Verwijderen in vervolg-migratie na 1 release.
  SELECT boek_inkooporder_ontvangst_stuks(...);
$$ LANGUAGE sql;
```

`boek_io_ontvangst_claims` wordt **niet** aangeraakt — die is Reservering's bezit sinds mig 254 met signature `(p_io_regel_id BIGINT, p_aantal_ontvangen INT)`. Reservering's Module-grens respecteren; `CREATE OR REPLACE FUNCTION` met een andere parameter-naam zou bovendien een Postgres-fout opleveren (parameter-renames vereisen `DROP FUNCTION` eerst).

### Ingreep 3 — Slot-pattern voor Reservering's `RegelClaimDetail`

Reservering's `RegelClaimDetail` (uit ADR-0015) toont per IO-claim-sub-rij minimaal "IO #1234, verwacht wk 22". Die IO-meta-data leeft in Inkoop's domein. Twee opties:

1. Reservering importeert direct uit `@/modules/inkoop` (creëert een module-cycle Reservering ↔ Inkoop)
2. Inkoop levert een **slot-component** dat Reservering's `RegelClaimDetail` opneemt via een prop

Kies optie 2 (Snijplanning-precedent ADR-0013 — Confectie's plan-sub-detail consumeert Snijplanning's slot zonder import-pad):

```tsx
// In modules/inkoop/components/inkoop-regel-samenvatting.tsx
export function InkoopRegelSamenvatting({ ioRegelId }: { ioRegelId: number }) {
  const { data } = useInkoopRegelSamenvatting(ioRegelId)
  // toont IO-nr, leverancier, verwacht_datum, status
}

// In modules/reserveringen/components/regel-claim-detail.tsx
type Props = {
  // ...
  renderInkoopSamenvatting?: (ioRegelId: number) => ReactNode
}
```

Caller-side (de page of host die `RegelClaimDetail` rendert) injecteert het slot:

```tsx
import { RegelClaimDetail } from '@/modules/reserveringen'
import { InkoopRegelSamenvatting } from '@/modules/inkoop'

<RegelClaimDetail
  regelId={r.id}
  renderInkoopSamenvatting={(ioRegelId) => <InkoopRegelSamenvatting ioRegelId={ioRegelId} />}
/>
```

Reservering blijft import-vrij van Inkoop. Cycle vermeden; depth bewaard.

### Ingreep 4 — Lint-script, ESLint-regel, Python-import TODO

- `scripts/lint-no-direct-inkooporder-write.sh` — scant `supabase/migrations/` en `supabase/functions/` op `INSERT INTO inkooporders`, `UPDATE inkooporders`, `DELETE FROM inkooporders` (idem voor `inkooporder_regels` en `leveranciers`) buiten een whitelist (mig 127-148, 254-255, nieuwe split-mig 257).
- ESLint `no-restricted-imports` regel voor oude paden (`@/lib/supabase/queries/inkooporders`, `@/lib/supabase/queries/leveranciers`, `@/components/inkooporders/*`, `@/pages/inkooporders/*`, `@/pages/leveranciers/*`) met ADR-0016-verwijzing.
- `import/import_inkoopoverzicht.py` krijgt een TODO-banner: dit script omzeilt RLS met de service-role-key (gebruiker-keuze 2026-05-13: geen RLS-bypass meer). Vervolg-werk: vervang door `create_inkooporder`-RPC die de Python-import via PostgREST gebruikt met respect voor RLS. Niet meegenomen in dit ADR's stappen — eigen vervolg-issue.

## Module-Interface (publieke barrel)

`modules/inkoop/index.ts` exporteert:

**Hooks (queries):** `useInkooporders`, `useInkooporder`, `useInkooporderRegels`, `useInkoopRegelSamenvatting` (voor slot), `useLeveranciers`, `useLeverancier`, `useLeverancierStats`.

**Hooks (mutations):** `useCreateInkooporder`, `useUpdateInkooporder`, `useBoekOntvangst` (één hook met `mode: 'stuks' | 'rollen'`-discriminator, achterliggende RPC kiezen).

**Cache:** `invalidateNaInkoopMutatie(qc, { isOntvangst? })` — chain'd naar `invalidateNaReserveringsmutatie` bij ontvangst-mutaties.

**Components:** `InkooporderFormDialog`, `InkooporderStatusBadge`, `OntvangstBoekenDialog`, `IORegelClaimsPopover`, `VoorraadOntvangstDialog`, `RolStickerLayout`, `LeverancierStatsCard`, `InkoopRegelSamenvatting`.

**Types:** `Inkooporder`, `InkooporderRegel`, `Leverancier`, `OntvangstResultaat`, `InkooporderStatus`, `BoekOntvangstStuksInput`, `BoekOntvangstRollenInput`, `InkoopRegelSamenvatting`.

Geen barrel-export van losse query-functies (`fetchInkooporders`, etc.) — alleen hooks naar buiten, conform Snijplanning- en Reservering-precedent.

## Frontend-folder-structuur

```
frontend/src/modules/inkoop/
├── index.ts                              ← barrel
├── cache.ts                              ← invalidateNaInkoopMutatie (NIEUW)
├── hooks/
│   ├── use-inkooporders.ts               ← NIEUW
│   ├── use-leveranciers.ts               ← NIEUW
│   └── use-boek-ontvangst.ts             ← NIEUW
├── queries/
│   ├── inkooporders.ts                   ← van lib/supabase/queries/inkooporders.ts (gesplitst ≤300L)
│   └── leveranciers.ts                   ← van lib/supabase/queries/leveranciers.ts
├── lib/
│   └── __tests__/
│       └── boek-ontvangst-contract.test.ts ← NIEUW (RPC-contract fixtures)
├── components/
│   ├── inkooporder-form-dialog.tsx       ← van components/inkooporders/
│   ├── inkooporder-status-badge.tsx      ← van components/inkooporders/
│   ├── ontvangst-boeken-dialog.tsx       ← van components/inkooporders/
│   ├── io-regel-claims-popover.tsx       ← van components/inkooporders/
│   ├── voorraad-ontvangst-dialog.tsx     ← van components/inkooporders/
│   ├── rol-sticker-layout.tsx            ← van components/inkooporders/
│   ├── leverancier-stats-card.tsx        ← NIEUW
│   └── inkoop-regel-samenvatting.tsx     ← NIEUW (slot voor Reservering)
└── pages/
    ├── inkooporders-overview.tsx         ← van pages/inkooporders/
    ├── inkooporder-detail.tsx            ← van pages/inkooporders/
    ├── rol-stickers-print.tsx            ← van pages/inkooporders/
    ├── leveranciers-overview.tsx         ← van pages/leveranciers/
    └── leverancier-detail.tsx            ← van pages/leveranciers/
```

## SQL-ingreep — Mig 257 (pure rename)

Pattern conform ADR-0015 / mig 254:

1. **Nieuwe namen aanmaken** met body 1-op-1 uit huidige versie:
   - `boek_inkooporder_ontvangst_stuks(...)` — body uit mig 254-versie van `boek_voorraad_ontvangst`, inclusief `PERFORM boek_io_ontvangst_claims(...)` voor de Reservering-claim-consume
   - `boek_inkooporder_ontvangst_rollen(...)` — body uit mig 133-136-versie van `boek_ontvangst`, inclusief rol-creatie en `voorraad_mutaties`-INSERT
2. **Oude namen DEPRECATEN** als thin wrappers die naar de nieuwe namen delegeren (back-compat voor één release).
3. **Geen body-herschrijving**, geen functie-signature-wijzigingen — dat is bewust uitgesteld naar latere migraties zodat de rename-migratie deterministisch reviewbaar blijft.
4. **`boek_io_ontvangst_claims` NIET aangeraakt** — bestaat sinds mig 254 met signature `(p_io_regel_id BIGINT, p_aantal_ontvangen INT)`. Het is Reservering-Module's bezit; Inkoop is consumer. `CREATE OR REPLACE FUNCTION` met andere parameter-naam zou bovendien een Postgres-fout opleveren (parameter-renames vereisen `DROP FUNCTION` eerst).

## Migratiepad

Conform "Na ADR direct stap 1/N committen": **ADR + Stap 1 (Module-skelet) in één commit**. Vervolgstappen 2-13 in `docs/superpowers/plans/2026-05-13-inkoop-als-deep-module.md`:

1. **Stap 1 — Module-skelet + cache + barrel** (deze commit)
2. **Stap 2 — Queries verhuizen** (inkooporders.ts gesplitst ≤300L, leveranciers.ts; re-export shim)
3. **Stap 3 — Hooks introduceren** (queries naar `useQuery`-wrappers)
4. **Stap 4 — Mig 257 rename** + back-compat thin wrappers
5. **Stap 5 — `useBoekOntvangst`** met mode-discriminator + contract-test-skelet
6. **Stap 6 — Components verhuizen** (6 components van `components/inkooporders/` naar `modules/inkoop/components/`)
7. **Stap 7 — `InkoopRegelSamenvatting`-slot** + Reservering's `RegelClaimDetail` prop aanvullen
8. **Stap 8 — Pages verhuizen** (5 pages van `pages/inkooporders/` + `pages/leveranciers/` naar `modules/inkoop/pages/`)
9. **Stap 9 — `LeverancierStatsCard`** + `useLeverancierStats`
10. **Stap 10 — Lint-script + ESLint-regel**
11. **Stap 11 — TODO-banner op `import/import_inkoopoverzicht.py`**
12. **Stap 12 — Oude bestanden verwijderen** na verificatie
13. **Stap 13 — Docs** (`architectuur.md` Module-graf-paragraaf — elfde Module; `data-woordenboek.md` Inkoop-Module-term; `changelog.md`)

## Overwogen alternatieven

- **Leveranciers als zelfstandige Module** — afgewezen. 97 regels query-code, geen eigen levenscyclus (geen contracten, condities, of EDI-credentials per leverancier in V1; EDI-config zit op `edi_handelspartner_config` per debiteur, mig 156). Pas opsplitsen wanneer Leverancier zelf een echte lifecycle krijgt.

- **`boek_voorraad_ontvangst` niet hernoemen, alleen FE verhuizen** — afgewezen. ADR-0015 had de open backlog voor deze rename al genoemd. Nu we Inkoop sowieso uitsnijden is dit het natuurlijke moment; pure rename is goedkoop en breekt de naming-asymmetrie.

- **Rol-creatie meteen naar Voorraad/Producten-Module verhuizen** — uitgesteld. Voorraad/Producten-Module bestaat nog niet als folder. Rol-creatie + `voorraad_mutaties`-INSERT blijven binnen Inkoop's rollen-pad-RPC geparkeerd met TODO-comment; eigenaar wordt later expliciet toegekend.

- **Python-script blijft RLS-bypassen** — afgewezen (gebruiker-keuze 2026-05-13: geen RLS-bypass meer). TODO-banner naar `create_inkooporder`-RPC in vervolg-werk; niet meegenomen in dit ADR's 13 stappen.

- **Routes hernoemen naar `/inkoop/...`** — afgewezen (bookmarks; Debiteur-precedent met `/klanten`-routes onder `modules/debiteuren/`). Pages verhuizen, route-paden blijven `/inkooporders` en `/leveranciers`.

- **Reservering importeert direct uit `@/modules/inkoop` voor IO-meta** — afgewezen. Creëert module-cycle Reservering ↔ Inkoop (Inkoop heeft Reservering's `boek_io_ontvangst_claims` als depend-on, plus consumeert Reservering's `useClaimsVoorIORegel` op de IO-detail-page). Slot-pattern lost dit elegant op — kosten is één extra prop in `RegelClaimDetail`, baten is acycliciteit.

- **Eén ontvangst-RPC met `mode`-parameter (stuks/rollen) ipv twee gerenamede** — afgewezen voor mig 257. Body-merge vereist parameter-set-unificatie (`p_rolnummer` is rollen-only, `p_aantal` is stuks-only), wat een echte body-herschrijving is. Rename in mig 257, body-merge eventueel later wanneer er een duidelijke trigger is.

## Open backlog

- Rol-creatie + voorraad_mutaties verhuizen naar toekomstige Producten/Voorraad-Module
- Inkoopgroepen-pages (klant-attribuut, ondanks de naam) naar Debiteur-Module
- Backward-compat thin wrappers `boek_voorraad_ontvangst` / `boek_ontvangst` verwijderen in vervolg-migratie na 1 release
- EDI-DESADV koppeling voor inkomende ontvangst-bevestigingen
- `create_inkooporder`-RPC voor initial-bulk-create-flow (vervangt Python-script's directe table-writes via PostgREST + RLS)
- `besteld_per_kwaliteit_kleur`-view (mig 137) eigendom verschuiven naar Voorraad/Producten-Module zodra die bestaat
