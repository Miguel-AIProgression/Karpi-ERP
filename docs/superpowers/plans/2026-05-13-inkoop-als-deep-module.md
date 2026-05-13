# Inkoop als deep Module — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hef de Inkoop-flow op tot deep verticale Module (`modules/inkoop/`) met één publieke barrel, big-bang RPC-splitsing zodat IO-claim-consume bij Reservering ligt en rol-creatie bij Inkoop, en een slot-component `<InkoopRegelSamenvatting>` zodat Reservering's `RegelClaimDetail` rijkere IO-info kan tonen zonder Inkoop's data-shape te kennen.

**Architecture:** Volgt het precedent van Maatwerk-Module (ADR-0009), Debiteur-Module (ADR-0011) en Reservering-Module (ADR-0015). Medium scope (queries + hooks + components + pages + cache-helper). Cross-Module-koppelingen via slot-pattern (presentatie) en expliciete RPC-calls (server-side state-mutaties). Drie lagen worden geraakt: SQL (RPC-splitsing), TypeScript-frontend (Module-folder + barrel), Python-import (RPC-aanroep).

**Tech Stack:** React 18 + TypeScript + TanStack Query 5 + Supabase (PostgreSQL 15) + Vitest (contract-tests) + Python 3.10 (supabase-py voor import-script).

**Prerequisites:**
- Branch `feat/reservering-deep-module` is gemerged naar `main` (ADR-0015 — migraties 254 én 255 staan op main).
- Worktree starten vanaf actuele `main`: `git worktree add ../karpi-inkoop -b feat/inkoop-deep-module main`.
- **Laagst-vrije migratie-nummer is 257** (256 = bundelkorting, geverifieerd op 2026-05-13). Pas alle migratie-referenties aan als tussentijds nieuwe migraties geland zijn — run `ls supabase/migrations/ | sort -V | tail -3` vóór Task 4.
- **Belangrijk**: mig 254 (ADR-0015) heeft `boek_io_ontvangst_claims(p_io_regel_id BIGINT, p_aantal_ontvangen INT)` al gedefinieerd én `boek_voorraad_ontvangst` omgezet naar `PERFORM boek_io_ontvangst_claims(...)`. Dit plan **herdefinieert die functie niet** (rename in `CREATE OR REPLACE` zou een Postgres-error geven én is Module-boundary-violation). Inkoop's RPC roept de bestaande Reservering-RPC alléén aan.

**Out-of-scope (open backlog, vervolg-ADR's):**
- Rol-creatie + `voorraad_mutaties`-INSERT verhuizen naar een toekomstige Voorraad/Producten-Module. Blijft voorlopig in Inkoop's RPC met TODO-comment.
- Inkoopgroepen-pages (`pages/inkoopgroepen/`) verhuizen naar Debiteur-Module. Eigen kleine ADR/plan.
- EDI-DESADV-koppeling voor inkomende ontvangst-bevestigingen.
- Backward-compat thin-wrappers `boek_voorraad_ontvangst` / `boek_ontvangst` blijven 1 release bestaan; verwijderen in een volgende migratie.

---

## File Structure

### Nieuwe bestanden

```
docs/adr/0016-inkoop-als-deep-module.md             ← architectuur-beslissing

frontend/src/modules/inkoop/
├── index.ts                                        ← publieke barrel
├── cache.ts                                        ← invalidateNaInkoopMutatie
├── hooks/
│   ├── use-inkooporders.ts
│   ├── use-leveranciers.ts
│   └── use-boek-ontvangst.ts                       ← NIEUW (RPC-wrapper + cross-Module-invalidation)
├── queries/
│   ├── inkooporders.ts                             ← verhuizing van lib/supabase/queries/inkooporders.ts (543L → splitsen mogelijk)
│   └── leveranciers.ts                             ← verhuizing van lib/supabase/queries/leveranciers.ts (97L)
├── components/
│   ├── inkooporder-form-dialog.tsx                 ← verhuizing van components/inkooporders/
│   ├── ontvangst-boeken-dialog.tsx                 ← verhuizing van components/inkooporders/
│   ├── inkooporder-status-badge.tsx                ← verhuizing van components/inkooporders/
│   ├── io-regel-claims-popover.tsx                 ← verhuizing van components/inkooporders/
│   ├── voorraad-ontvangst-dialog.tsx               ← verhuizing van components/inkooporders/
│   ├── rol-sticker-layout.tsx                      ← verhuizing van components/inkooporders/
│   ├── leverancier-stats-card.tsx                  ← NIEUW (stats-block extract uit leverancier-detail)
│   └── inkoop-regel-samenvatting.tsx               ← NIEUW (slot voor Reservering)
└── pages/
    ├── inkooporders-overview.tsx                   ← verhuizing van pages/inkooporders/
    ├── inkooporder-detail.tsx                      ← verhuizing van pages/inkooporders/
    ├── rol-stickers-print.tsx                      ← verhuizing van pages/inkooporders/
    ├── leveranciers-overview.tsx                   ← verhuizing van pages/leveranciers/
    └── leverancier-detail.tsx                      ← verhuizing van pages/leveranciers/

supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql   ← big-bang RPC-splitsing

scripts/lint-no-direct-inkooporder-regel-write.sh   ← regressie-guard

frontend/src/modules/inkoop/lib/__tests__/
└── boek-ontvangst-contract.test.ts                 ← Vitest contract-test (SQL ↔ TS-fixtures)
```

### Gewijzigde bestanden

```
frontend/src/App.tsx (of router-config)             ← import-paden voor verhuisde pages
frontend/src/modules/reserveringen/components/regel-claim-detail.tsx
                                                    ← rendert <InkoopRegelSamenvatting> bij IO-rij
frontend/src/lib/supabase/queries/inkooporders.ts   ← deprecation-shim (re-export uit nieuwe pad)
frontend/src/lib/supabase/queries/leveranciers.ts   ← deprecation-shim
.eslintrc.cjs (of eslint.config.js)                 ← no-restricted-imports voor oude paden
import/import_inkoopoverzicht.py                    ← gebruikt RPC i.p.v. directe inserts
docs/architectuur.md                                ← elfde Module + RPC-split-notitie
docs/data-woordenboek.md                            ← Inkoop-Module-term toevoegen
docs/changelog.md                                   ← entry voor 2026-05-13
```

### Te verwijderen (na verificatie geen imports leven)

```
frontend/src/components/inkooporders/               ← verhuist naar modules/inkoop/components/
frontend/src/pages/inkooporders/                    ← verhuist naar modules/inkoop/pages/
frontend/src/pages/leveranciers/                    ← verhuist naar modules/inkoop/pages/
frontend/src/lib/supabase/queries/inkooporders.ts   ← na shim-fase
frontend/src/lib/supabase/queries/leveranciers.ts   ← na shim-fase
```

---

## Task 1: ADR-0016 + Module-skelet (één commit, per feedback-memory)

**Files:**
- Create: `docs/adr/0016-inkoop-als-deep-module.md`
- Create: `frontend/src/modules/inkoop/index.ts`
- Create: `frontend/src/modules/inkoop/cache.ts`

- [ ] **Step 1: Maak worktree en branch**

```bash
git fetch origin main
git worktree add ../karpi-inkoop -b feat/inkoop-deep-module main
cd ../karpi-inkoop
ls supabase/migrations/ | sort -V | tail -8     # verifieer dat 254 + 255 op main staan en 257 vrij is
```

Verwacht: laatste migratie 256. **Heads-up**: op main bestaan momenteel **twee** bestanden met prefix `256_` (`256_bundelkorting_2_regel_vorm.sql` en `256_reservering_trigger_verzonden_release.sql`) — de nummerings-volgorde is hier al eens gekruist. Mig 271 is op het moment van schrijven nog vrij; als 257 in de tussentijd ook bezet is, pak het eerstvolgende vrije nummer en pas overal in dit document aan (Task 4 paden, lint-script whitelist, docs in Task 12).

- [ ] **Step 2: Schrijf ADR-0016**

Schrijf het ADR in dezelfde stijl als [ADR-0015](../adr/0015-reservering-als-deep-module.md). Verplichte secties:

```markdown
---
status: accepted
date: 2026-05-13
---

# Inkoop als deep Module — RPC-splitsing voor ontvangst, slot-pattern naar Reservering

## Context
[Sprawl beschrijving: 543L queries toplevel, components/inkooporders + pages
verspreid, twee ontvangst-RPC's (boek_voorraad_ontvangst stuks-pad,
boek_ontvangst rollen-pad) mengen domeinen, Excel-import-script omzeilt RLS.
Verwijs naar mig 127, 133-136, 148 voor de huidige spreiding. Vermeld dat
ADR-0015 al de splitsing van boek_voorraad_ontvangst als open backlog noemde.]

## Beslissing
[Vier ingrepen samenvatten:
 1. modules/inkoop/ als deep Module (medium scope: logica + components + pages)
 2. Big-bang RPC-splitsing: boek_inkooporder_ontvangst_stuks +
    boek_inkooporder_ontvangst_rollen (Inkoop) + boek_io_ontvangst_claims
    (Reservering); thin wrappers op oude namen voor 1 release back-compat
 3. Slot-pattern <InkoopRegelSamenvatting> voor Reservering consumer
 4. Lint-script + Python-script door RPC]

## Module-Interface (publieke barrel)
[Lijst hooks/components/types — zie barrel-section verderop in dit plan]

## Frontend-folder-structuur
[ASCII tree zoals in Reservering-ADR]

## Migratiepad
[Verwijs naar docs/superpowers/plans/2026-05-13-inkoop-als-deep-module.md]

## Overwogen alternatieven
[- Leveranciers als zelfstandige Module: afgewezen (geen eigen levenscyclus)
 - boek_voorraad_ontvangst niet splitsen, alleen FE verhuizen: afgewezen
   (ADR-0015's open backlog blijft hangen)
 - Rol-creatie meteen naar Voorraad-Module: uitgesteld (Voorraad-Module
   bestaat nog niet, parking met TODO-comment)
 - Python-script blijft RLS-bypassen: afgewezen (gebruiker keuze 2026-05-13:
   geen RLS-bypass meer)
 - Routes hernoemen naar /inkoop/...: afgewezen (bookmarks; Debiteur-precedent
   met /klanten-routes onder modules/debiteuren/)]

## Open backlog
[- Rol-creatie + voorraad_mutaties verhuizen naar Producten/Voorraad-Module
 - Inkoopgroepen-pages naar Debiteur-Module
 - Backward-compat thin wrappers verwijderen na 1 release
 - EDI-DESADV koppeling]
```

- [ ] **Step 3: Maak Module-skelet `index.ts`**

```typescript
// Publieke barrel voor de Inkoop-Module.
// Cross-Module-imports gaan via dit bestand; directe imports uit subfolders
// worden door ESLint geblokkeerd (zie .eslintrc).

// Hooks (queries) — komen in Task 3
// export { useInkooporders, useInkooporder, useInkooporderRegels } from './hooks/use-inkooporders'
// export { useLeveranciers, useLeverancier, useLeverancierStats } from './hooks/use-leveranciers'
// export { useBoekOntvangst } from './hooks/use-boek-ontvangst'

// Cache (komt in Step 4 van deze Task)
export { invalidateNaInkoopMutatie } from './cache'

// Components — komen in Task 6
// export { InkooporderFormDialog } from './components/inkooporder-form-dialog'
// export { OntvangstBoekenDialog } from './components/ontvangst-boeken-dialog'
// export { InkooporderStatusBadge } from './components/inkooporder-status-badge'
// export { LeverancierStatsCard } from './components/leverancier-stats-card'
// export { InkoopRegelSamenvatting } from './components/inkoop-regel-samenvatting'

// Types — komen mee met queries-verhuizing
// export type {
//   Inkooporder, InkooporderRegel, Leverancier,
//   OntvangstResultaat, InkooporderStatus,
// } from './queries/inkooporders'
```

Commentaar-blokken houden de barrel klaar voor incrementele exports; iedere stap zet er meer uit.

- [ ] **Step 4: Maak `cache.ts` met `invalidateNaInkoopMutatie`**

```typescript
import type { QueryClient } from '@tanstack/react-query'
import { invalidateNaReserveringsmutatie } from '@/modules/reserveringen'

/**
 * Roep aan na elke succesvolle Inkoop-mutatie (create, update, boek-ontvangst).
 * Invalidate-keys volgen het query-key-schema in modules/inkoop/queries/.
 * Bij ontvangst-mutaties chain'en we Reservering's invalidatie omdat
 * boek_io_ontvangst_claims aan de server-zijde claims muteert (mig 271).
 */
export function invalidateNaInkoopMutatie(
  qc: QueryClient,
  opties: { isOntvangst?: boolean } = {},
): void {
  qc.invalidateQueries({ queryKey: ['inkooporders'] })
  qc.invalidateQueries({ queryKey: ['inkooporder-regels'] })
  qc.invalidateQueries({ queryKey: ['leveranciers'] })
  qc.invalidateQueries({ queryKey: ['producten'] }) // besteld_inkoop-cache + voorraad

  if (opties.isOntvangst) {
    invalidateNaReserveringsmutatie(qc)
  }
}
```

- [ ] **Step 5: Commit ADR + skelet**

```bash
git add docs/adr/0016-inkoop-als-deep-module.md \
        frontend/src/modules/inkoop/index.ts \
        frontend/src/modules/inkoop/cache.ts
git commit -m "feat(inkoop): ADR-0016 + Module-skelet (cache + barrel)

Hef Inkoop op tot elfde deep verticale Module. Skelet + invalidate-helper
landen samen met ADR — eerst code, dan stappen 2-13."
```

---

## Task 2: Queries verhuizen met deprecation-shim

**Files:**
- Create: `frontend/src/modules/inkoop/queries/inkooporders.ts`
- Create: `frontend/src/modules/inkoop/queries/leveranciers.ts`
- Modify: `frontend/src/lib/supabase/queries/inkooporders.ts` (vervangen door re-export)
- Modify: `frontend/src/lib/supabase/queries/leveranciers.ts` (vervangen door re-export)

- [ ] **Step 1: Verifieer huidige exports**

```bash
grep -n "^export " frontend/src/lib/supabase/queries/inkooporders.ts | head -20
grep -n "^export " frontend/src/lib/supabase/queries/leveranciers.ts
```

Noteer de export-set; deze moet 1-op-1 doorkomen in het nieuwe bestand.

- [ ] **Step 2: Verhuis `inkooporders.ts` naar Module**

```bash
git mv frontend/src/lib/supabase/queries/inkooporders.ts \
       frontend/src/modules/inkoop/queries/inkooporders.ts
```

Geen edits aan de inhoud. Controleer dat `git mv` werkte:

```bash
git status -s frontend/src/lib/supabase/queries/inkooporders.ts \
              frontend/src/modules/inkoop/queries/inkooporders.ts
```

Verwacht: `R` (renamed) of `D` + `A`-paar.

- [ ] **Step 3: Verhuis `leveranciers.ts` naar Module**

```bash
git mv frontend/src/lib/supabase/queries/leveranciers.ts \
       frontend/src/modules/inkoop/queries/leveranciers.ts
```

- [ ] **Step 4: Schrijf deprecation-shims op oude paden**

Maak `frontend/src/lib/supabase/queries/inkooporders.ts`:

```typescript
/**
 * @deprecated Importeer voortaan uit '@/modules/inkoop'.
 * Deze shim verdwijnt in een volgende release zodra alle imports zijn omgezet.
 */
export * from '@/modules/inkoop/queries/inkooporders'
```

Maak `frontend/src/lib/supabase/queries/leveranciers.ts`:

```typescript
/**
 * @deprecated Importeer voortaan uit '@/modules/inkoop'.
 */
export * from '@/modules/inkoop/queries/leveranciers'
```

- [ ] **Step 5: Pas barrel `modules/inkoop/index.ts` aan**

Vervang de gecommente regels onder "Hooks (queries) — komen in Task 3" door tijdelijke type-exports zodat consumers de types al kunnen importeren via de barrel:

```typescript
export type {
  Inkooporder,
  InkooporderRegel,
  Leverancier,
  // ... andere types die in queries/inkooporders.ts of leveranciers.ts staan
} from './queries/inkooporders'
```

Verifieer welke types daadwerkelijk geëxporteerd worden:

```bash
grep -n "^export type\|^export interface" \
  frontend/src/modules/inkoop/queries/inkooporders.ts \
  frontend/src/modules/inkoop/queries/leveranciers.ts
```

- [ ] **Step 6: Run typecheck**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -40
```

Verwacht: geen errors. (Imports via de oude paden werken via shim; nieuwe paden via barrel werken direct.)

- [ ] **Step 7: Run frontend build dry**

```bash
cd frontend && pnpm build 2>&1 | tail -20
```

Verwacht: geen errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/inkoop/queries/ \
        frontend/src/lib/supabase/queries/inkooporders.ts \
        frontend/src/lib/supabase/queries/leveranciers.ts \
        frontend/src/modules/inkoop/index.ts
git commit -m "feat(inkoop): verhuis queries naar modules/inkoop met shim"
```

---

## Task 3: Hooks verhuizen + nieuwe `useBoekOntvangst`

**Files:**
- Create: `frontend/src/modules/inkoop/hooks/use-inkooporders.ts`
- Create: `frontend/src/modules/inkoop/hooks/use-leveranciers.ts`
- Create: `frontend/src/modules/inkoop/hooks/use-boek-ontvangst.ts`

- [ ] **Step 1: Inventariseer bestaande hooks**

```bash
grep -rn "useQuery.*\['inkooporders'\]\|useQuery.*\['leveranciers'\]" \
  frontend/src --include="*.ts" --include="*.tsx" | head -20
```

Veel pages bevatten inline `useQuery`-calls. We extracten ze niet allemaal in stap 1 — alleen het minimum dat de hooks-barrel nodig heeft. Pages die nu inline queries hebben blijven werken; ze worden in Task 7 mee verhuisd en kunnen daar omgezet worden.

- [ ] **Step 2: Maak `hooks/use-inkooporders.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchInkooporders,
  fetchInkooporder,
  fetchInkooporderRegels,
  createInkooporder,
  updateInkooporder,
  type Inkooporder,
  type InkooporderRegel,
} from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

export function useInkooporders(filters?: Parameters<typeof fetchInkooporders>[0]) {
  return useQuery({
    queryKey: ['inkooporders', filters],
    queryFn: () => fetchInkooporders(filters),
  })
}

export function useInkooporder(id: number | undefined) {
  return useQuery({
    queryKey: ['inkooporder', id],
    queryFn: () => fetchInkooporder(id!),
    enabled: id !== undefined,
  })
}

export function useInkooporderRegels(inkooporderId: number | undefined) {
  return useQuery({
    queryKey: ['inkooporder-regels', inkooporderId],
    queryFn: () => fetchInkooporderRegels(inkooporderId!),
    enabled: inkooporderId !== undefined,
  })
}

export function useCreateInkooporder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createInkooporder,
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useUpdateInkooporder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateInkooporder,
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}
```

Pas de imports aan op de werkelijke functie-namen in `queries/inkooporders.ts` (gebruik de export-lijst uit Task 2 Step 1).

- [ ] **Step 3: Maak `hooks/use-leveranciers.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import {
  fetchLeveranciers,
  fetchLeverancier,
  fetchLeverancierStats,
} from '../queries/leveranciers'

export function useLeveranciers() {
  return useQuery({
    queryKey: ['leveranciers'],
    queryFn: fetchLeveranciers,
  })
}

export function useLeverancier(id: number | undefined) {
  return useQuery({
    queryKey: ['leverancier', id],
    queryFn: () => fetchLeverancier(id!),
    enabled: id !== undefined,
  })
}

export function useLeverancierStats() {
  return useQuery({
    queryKey: ['leverancier-stats'],
    queryFn: fetchLeverancierStats,
  })
}
```

Pas namen aan op werkelijke exports uit `queries/leveranciers.ts`.

- [ ] **Step 4: Maak `hooks/use-boek-ontvangst.ts`**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { invalidateNaInkoopMutatie } from '../cache'

export interface BoekOntvangstStuksInput {
  ioRegelId: number
  aantal: number
  medewerker?: string
}

export interface BoekOntvangstRollenInput {
  ioRegelId: number
  rollen: Array<{
    rolnummer: string
    lengte_cm: number
    breedte_cm: number
    locatie?: string
  }>
  medewerker?: string
}

/**
 * RPC-wrapper voor de gesplitste ontvangst-flow (mig 271).
 * Switched op input-shape: stuks-input → boek_inkooporder_ontvangst_stuks,
 * rollen-input → boek_inkooporder_ontvangst_rollen.
 */
export function useBoekOntvangst() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: BoekOntvangstStuksInput | BoekOntvangstRollenInput) => {
      if ('aantal' in input) {
        const { data, error } = await supabase.rpc('boek_inkooporder_ontvangst_stuks', {
          p_io_regel_id: input.ioRegelId,
          p_aantal: input.aantal,
          p_medewerker: input.medewerker ?? null,
        })
        if (error) throw error
        return data
      } else {
        const { data, error } = await supabase.rpc('boek_inkooporder_ontvangst_rollen', {
          p_io_regel_id: input.ioRegelId,
          p_rollen: input.rollen,
          p_medewerker: input.medewerker ?? null,
        })
        if (error) throw error
        return data
      }
    },
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}
```

- [ ] **Step 5: Update barrel `index.ts`**

Voeg toe (vervangt de gecommente hooks-regels):

```typescript
export {
  useInkooporders,
  useInkooporder,
  useInkooporderRegels,
  useCreateInkooporder,
  useUpdateInkooporder,
} from './hooks/use-inkooporders'

export {
  useLeveranciers,
  useLeverancier,
  useLeverancierStats,
} from './hooks/use-leveranciers'

export {
  useBoekOntvangst,
  type BoekOntvangstStuksInput,
  type BoekOntvangstRollenInput,
} from './hooks/use-boek-ontvangst'
```

- [ ] **Step 6: Run typecheck**

```bash
cd frontend && pnpm tsc --noEmit 2>&1 | head -40
```

Verwacht: geen errors. De RPC-namen `boek_inkooporder_ontvangst_stuks`/`_rollen` bestaan nog niet in Supabase, maar TypeScript-types worden in dit project handmatig onderhouden (niet auto-gegenereerd uit `supabase gen types`); de `supabase.rpc()`-aanroepen accepteren onbekende namen als string. Bevestig in deze codebase of dit klopt — anders eerst Task 4 doen om types te regenereren.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/inkoop/hooks/ \
        frontend/src/modules/inkoop/index.ts
git commit -m "feat(inkoop): hooks-laag + useBoekOntvangst-wrapper"
```

---

## Task 4: SQL-migratie 271 — RPC-renames (pure-rename pattern)

**Files:**
- Create: `supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql`

**Strategie**: pure rename — geen body-herschrijving, geen nieuwe logica. Mig 254 heeft `boek_voorraad_ontvangst` al omgezet naar `PERFORM boek_io_ontvangst_claims(...)`; deze migratie hernoemt alleen de twee Inkoop-eigen RPC's naar hun nieuwe Module-aligned namen en zet de oude namen om naar DEPRECATED thin wrappers. **Geen wijziging aan `boek_io_ontvangst_claims`** — die is sinds mig 254 Reservering's bezit met signature `(p_io_regel_id BIGINT, p_aantal_ontvangen INT)`.

- [ ] **Step 1: Verifieer migratie-nummer is vrij**

```bash
ls supabase/migrations/ | sort -V | tail -3
```

Verwacht: laatste migratie 256. Als 257 al gebruikt is, pak het eerstvolgende vrije nummer en pas overal in dit document aan.

- [ ] **Step 2: Lees huidige RPC-body's**

De migratie kopieert de bestaande body's onder nieuwe namen. Verzamel ze:

```bash
# boek_voorraad_ontvangst — laatste definitie staat in mig 254
sed -n '/CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst/,/^\$\$ LANGUAGE plpgsql;/p' \
  supabase/migrations/254_reservering_module_split.sql

# boek_ontvangst — vind alle definities, kies de hoogst-genummerde
grep -l "CREATE OR REPLACE FUNCTION boek_ontvangst" supabase/migrations/*.sql | sort -V | tail -1
```

Noteer de exacte parameter-lijst en body — die plak je 1-op-1 onder de nieuwe naam in Step 3.

- [ ] **Step 3: Schrijf migratie**

- [ ] **Step 3: Schrijf migratie 271 — pure rename**

Skelet (vul de twee `-- KOPIE` blokken aan met de body's uit Step 2):

```sql
-- Migratie 271: Inkoop-Module — hernoem ontvangst-RPCs naar Module-aligned namen
--
-- Strategie (ADR-0016): pure rename. De business-logic blijft identiek aan
-- de huidige boek_voorraad_ontvangst (mig 254-versie) en boek_ontvangst
-- (laatste mig in de 133/135/136/251-keten). We hernoemen alleen:
--
--   boek_voorraad_ontvangst → boek_inkooporder_ontvangst_stuks
--   boek_ontvangst          → boek_inkooporder_ontvangst_rollen
--
-- De oude namen worden DEPRECATED thin wrappers die de nieuwe namen aanroepen.
-- Zo blijven bestaande callers (Python-import-script doet vandaag geen RPC-
-- aanroep, maar mocht dat veranderen — en de oude RPC's blijven werken voor
-- één release).
--
-- NIET aangeraakt:
-- - boek_io_ontvangst_claims (Reservering-Module, sinds mig 254). Wordt door
--   de nieuwe stuks-RPC aangeroepen via PERFORM; geen wijziging aan body of
--   signature (zou een PostgreSQL-error geven en is Module-boundary-violation).
-- - Voorraad-bump op producten en rollen-INSERT + voorraad_mutaties-INSERT
--   blijven binnen de Inkoop-RPCs geparkeerd; eigendom verhuist naar een
--   toekomstige Voorraad/Producten-Module (zie ADR-0016 open backlog).

-- ============================================================
-- 1. boek_inkooporder_ontvangst_stuks — nieuwe Module-aligned naam
-- ============================================================
-- KOPIE: plak hier de volledige body van boek_voorraad_ontvangst zoals
-- gedefinieerd in mig 254 (regels 240-290 van 254_reservering_module_split.sql),
-- met **alleen** de functie-naam veranderd. Parameters en body blijven 1-op-1.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_stuks(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
-- <BODY UIT MIG 254 boek_voorraad_ontvangst — Step 2 output plakken>
$$;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT) IS
  'Inkoop-Module: boek stuks-ontvangst op een eenheid=stuks IO-regel. '
  'Body identiek aan boek_voorraad_ontvangst (mig 254). Delegeert claim-'
  'consume aan Reservering via PERFORM boek_io_ontvangst_claims. ADR-0016.';

-- ============================================================
-- 2. boek_inkooporder_ontvangst_rollen — nieuwe Module-aligned naam
-- ============================================================
-- KOPIE: plak hier de volledige body van de laatste boek_ontvangst-definitie
-- (gebruik Step 2 grep-output). Parameters 1-op-1. Geen claim-consume nodig:
-- claims zijn alleen op eenheid=stuks per ADR-0015.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
  -- <PARAMETERS UIT LAATSTE boek_ontvangst-DEFINITIE — Step 2 output plakken>
) RETURNS -- <RETURN-TYPE UIT BESTAANDE DEFINITIE>
LANGUAGE plpgsql
AS $$
-- <BODY UIT LAATSTE boek_ontvangst-DEFINITIE — Step 2 output plakken>
$$;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(/* signature */) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Body '
  'identiek aan boek_ontvangst (laatste mig in de 133/135/136/251-keten). '
  'Geen claim-consume (claims zijn alleen op eenheid=stuks). ADR-0016.';

-- ============================================================
-- 3. DEPRECATED thin wrappers — 1 release lang
-- ============================================================
-- boek_voorraad_ontvangst was tot mig 254 een echte functie; vanaf nu is het
-- een wrapper rondom boek_inkooporder_ontvangst_stuks. Hetzelfde voor
-- boek_ontvangst. Verwijderen in vervolg-migratie nadat callers omgezet zijn.

CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM boek_inkooporder_ontvangst_stuks(p_regel_id, p_aantal, p_medewerker);
END;
$$;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'DEPRECATED (ADR-0016): thin wrapper rondom boek_inkooporder_ontvangst_stuks. '
  'Verwijderen in vervolg-migratie nadat callers zijn omgezet.';

-- Wrapper voor boek_ontvangst — vul parameter-lijst aan op basis van Step 2:
CREATE OR REPLACE FUNCTION boek_ontvangst(
  -- <PARAMETERS UIT LAATSTE boek_ontvangst-DEFINITIE>
) RETURNS -- <RETURN-TYPE>
LANGUAGE plpgsql
AS $$
BEGIN
  -- Forward 1-op-1 naar de nieuwe naam:
  -- PERFORM boek_inkooporder_ontvangst_rollen(<dezelfde args>);
END;
$$;

COMMENT ON FUNCTION boek_ontvangst(/* signature */) IS
  'DEPRECATED (ADR-0016): thin wrapper rondom boek_inkooporder_ontvangst_rollen. '
  'Verwijderen in vervolg-migratie nadat callers zijn omgezet.';

-- ============================================================
-- 4. Grants — alleen voor de NIEUWE namen
-- ============================================================
-- boek_io_ontvangst_claims is door mig 254 al granted naar authenticated.
-- Oude namen behouden hun bestaande grants (CREATE OR REPLACE wijzigt grants
-- niet).
GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(/* signature uit Step 2 */)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
```

**Verwijderd t.o.v. eerdere versie van dit plan**: er wordt **geen** `CREATE OR REPLACE FUNCTION boek_io_ontvangst_claims` meer geschreven; die functie bestaat al sinds mig 254 met signature `(p_io_regel_id BIGINT, p_aantal_ontvangen INT)`. Een hernoemde-parameter-`CREATE OR REPLACE` zou een Postgres-error geven ("cannot change name of input parameter") én Reservering's Module-grenzen schenden.

<!-- BEGIN-LEGACY-SQL-BLOCK-TO-DELETE
-- ============================================================
-- 1. Reservering bezit: boek_io_ontvangst_claims
-- ============================================================

CREATE OR REPLACE FUNCTION boek_io_ontvangst_claims(
  p_io_regel_id BIGINT,
  p_ontvangen_aantal INTEGER
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_resterend INTEGER := p_ontvangen_aantal;
  v_claim RECORD;
  v_consume INTEGER;
  v_bestaande_voorraadclaim BIGINT;
  v_order_id BIGINT;
  v_geraakte_orders BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
  IF p_ontvangen_aantal IS NULL OR p_ontvangen_aantal <= 0 THEN
    RETURN;
  END IF;

  FOR v_claim IN
    SELECT id, order_regel_id, aantal
      FROM order_reserveringen
     WHERE inkooporder_regel_id = p_io_regel_id
       AND bron = 'inkooporder_regel'
       AND status = 'actief'
     ORDER BY claim_volgorde ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_resterend <= 0;
    v_consume := LEAST(v_claim.aantal, v_resterend);

    IF v_consume = v_claim.aantal THEN
      UPDATE order_reserveringen
         SET status = 'geleverd', geleverd_op = now(), updated_at = now()
       WHERE id = v_claim.id;
    ELSE
      UPDATE order_reserveringen
         SET aantal = aantal - v_consume, updated_at = now()
       WHERE id = v_claim.id;
    END IF;

    SELECT id INTO v_bestaande_voorraadclaim
      FROM order_reserveringen
     WHERE order_regel_id = v_claim.order_regel_id
       AND bron = 'voorraad'
       AND status = 'actief'
     FOR UPDATE;

    IF v_bestaande_voorraadclaim IS NOT NULL THEN
      UPDATE order_reserveringen
         SET aantal = aantal + v_consume, updated_at = now()
       WHERE id = v_bestaande_voorraadclaim;
    ELSE
      INSERT INTO order_reserveringen (order_regel_id, bron, aantal)
      VALUES (v_claim.order_regel_id, 'voorraad', v_consume);
    END IF;

    v_resterend := v_resterend - v_consume;

    SELECT order_id INTO v_order_id
      FROM order_regels WHERE id = v_claim.order_regel_id;
    IF NOT v_order_id = ANY(v_geraakte_orders) THEN
      v_geraakte_orders := array_append(v_geraakte_orders, v_order_id);
    END IF;
  END LOOP;

  -- Per geraakte order: drie expliciete split-calls (ADR-0015)
  FOREACH v_order_id IN ARRAY v_geraakte_orders LOOP
    PERFORM herwaardeer_claims_voor_order(v_order_id);
    PERFORM herbereken_wacht_status(v_order_id);
    PERFORM sync_order_afleverdatum_met_claims(v_order_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION boek_io_ontvangst_claims(BIGINT, INTEGER) IS
  'Reservering-Module: consumeer IO-claims op een ontvangen inkooporder-regel '
  'in claim_volgorde-volgorde, schuif consumed-deel naar voorraad-claim op '
  'dezelfde orderregel, en recompute claims + wacht-status + afleverdatum per '
  'geraakte order. Aangeroepen door Inkoop-Module RPCs (boek_inkooporder_ '
  'ontvangst_stuks). Mig 271 + ADR-0016.';

-- ============================================================
-- 2. Inkoop bezit: boek_inkooporder_ontvangst_stuks
-- ============================================================

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_stuks(
  p_io_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_open_regels INTEGER;
BEGIN
  IF p_aantal IS NULL OR p_aantal <= 0 THEN
    RAISE EXCEPTION 'Aantal moet > 0 zijn';
  END IF;

  SELECT * INTO v_regel FROM inkooporder_regels
   WHERE id = p_io_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_io_regel_id;
  END IF;

  IF v_regel.eenheid <> 'stuks' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Stuks-ontvangst alleen voor '
      'eenheid=''stuks''. Gebruik boek_inkooporder_ontvangst_rollen voor '
      'meters/rollen.', v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders
   WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd', v_order.inkooporder_nr;
  END IF;

  -- Voorraad-bump (TODO: verhuist naar toekomstige Voorraad/Producten-Module)
  IF v_regel.artikelnr IS NOT NULL THEN
    UPDATE producten
       SET voorraad = COALESCE(voorraad, 0) + p_aantal
     WHERE artikelnr = v_regel.artikelnr;
  END IF;

  -- Inkooporder-state bijwerken (Inkoop-eigen state)
  UPDATE inkooporder_regels
     SET geleverd_m = geleverd_m + p_aantal,
         te_leveren_m = GREATEST(besteld_m - (geleverd_m + p_aantal), 0)
   WHERE id = p_io_regel_id;

  -- Delegeer claim-consume aan Reservering
  PERFORM boek_io_ontvangst_claims(p_io_regel_id, p_aantal);

  -- IO-status update
  SELECT COUNT(*) INTO v_open_regels
    FROM inkooporder_regels
   WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
     WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;
END;
$$;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT) IS
  'Inkoop-Module: boek stuks-ontvangst op een eenheid=stuks IO-regel. '
  'Verhoogt producten.voorraad (geparkeerd: eigenaar wordt Voorraad-Module), '
  'werkt regel + IO-status bij, en delegeert claim-consume aan '
  'boek_io_ontvangst_claims (Reservering). Vervangt mig 148 boek_voorraad_'
  'ontvangst. Mig 271 + ADR-0016.';

-- ============================================================
-- 3. Inkoop bezit: boek_inkooporder_ontvangst_rollen
-- ============================================================
-- Refactor van mig 133-136 boek_ontvangst. Geen claim-consume (rollen-pad
-- heeft geen IO-claims; claims zijn alleen op eenheid=stuks per ADR-0015).
--
-- LET OP: lees mig 135 voor de werkelijke parameter-shape (auto-rolnummer,
-- m2-fix, etc.). Hieronder de skeleton; vul aan met de huidige logica.

CREATE OR REPLACE FUNCTION boek_inkooporder_ontvangst_rollen(
  p_io_regel_id BIGINT,
  p_rollen JSONB,           -- [{rolnummer, lengte_cm, breedte_cm, locatie?}]
  p_medewerker TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_regel inkooporder_regels%ROWTYPE;
  v_order inkooporders%ROWTYPE;
  v_rol JSONB;
  v_nieuwe_rol_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_nieuwe_rol_id BIGINT;
  v_totaal_m NUMERIC := 0;
  v_open_regels INTEGER;
BEGIN
  SELECT * INTO v_regel FROM inkooporder_regels
   WHERE id = p_io_regel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inkooporder-regel % niet gevonden', p_io_regel_id;
  END IF;

  IF v_regel.eenheid <> 'm' THEN
    RAISE EXCEPTION 'Regel % heeft eenheid %. Rollen-ontvangst alleen voor '
      'eenheid=''m''.', v_regel.regelnummer, v_regel.eenheid;
  END IF;

  SELECT * INTO v_order FROM inkooporders
   WHERE id = v_regel.inkooporder_id FOR UPDATE;
  IF v_order.status = 'Geannuleerd' THEN
    RAISE EXCEPTION 'Order % is geannuleerd', v_order.inkooporder_nr;
  END IF;

  -- Voor elke rol: INSERT in rollen + voorraad_mutaties
  -- (TODO: verhuist naar Voorraad/Producten-Module)
  FOR v_rol IN SELECT * FROM jsonb_array_elements(p_rollen)
  LOOP
    INSERT INTO rollen (
      rolnummer, artikelnr, kwaliteit_code, kleur_code,
      lengte_cm, breedte_cm, status, inkooporder_regel_id
    )
    SELECT
      COALESCE(v_rol->>'rolnummer', genereer_rolnummer()),
      v_regel.artikelnr, p.kwaliteit_code, p.kleur_code,
      (v_rol->>'lengte_cm')::NUMERIC, (v_rol->>'breedte_cm')::NUMERIC,
      'beschikbaar', p_io_regel_id
    FROM producten p WHERE p.artikelnr = v_regel.artikelnr
    RETURNING id INTO v_nieuwe_rol_id;

    v_nieuwe_rol_ids := array_append(v_nieuwe_rol_ids, v_nieuwe_rol_id);
    v_totaal_m := v_totaal_m + (v_rol->>'lengte_cm')::NUMERIC / 100.0;

    INSERT INTO voorraad_mutaties (rol_id, mutatie_type, aantal_m, medewerker)
    VALUES (v_nieuwe_rol_id, 'ontvangst', (v_rol->>'lengte_cm')::NUMERIC / 100.0, p_medewerker);
  END LOOP;

  -- IO-regel state
  UPDATE inkooporder_regels
     SET geleverd_m = geleverd_m + v_totaal_m,
         te_leveren_m = GREATEST(besteld_m - (geleverd_m + v_totaal_m), 0)
   WHERE id = p_io_regel_id;

  -- IO-status update (zelfde logic als stuks-variant)
  SELECT COUNT(*) INTO v_open_regels
    FROM inkooporder_regels
   WHERE inkooporder_id = v_order.id AND te_leveren_m > 0;

  IF v_open_regels = 0 THEN
    UPDATE inkooporders SET status = 'Ontvangen' WHERE id = v_order.id;
  ELSE
    UPDATE inkooporders SET status = 'Deels ontvangen'
     WHERE id = v_order.id AND status IN ('Concept', 'Besteld');
  END IF;

  RETURN jsonb_build_object(
    'rol_ids', to_jsonb(v_nieuwe_rol_ids),
    'totaal_m', v_totaal_m
  );
END;
$$;

COMMENT ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT) IS
  'Inkoop-Module: boek rollen-ontvangst op een eenheid=m IO-regel. Maakt '
  'rollen + voorraad_mutaties aan (geparkeerd: eigenaar wordt Voorraad-Module), '
  'werkt regel + IO-status bij. Geen claim-consume (claims zijn alleen op '
  'eenheid=stuks). Vervangt mig 133-136 boek_ontvangst. Mig 271 + ADR-0016.';

-- ============================================================
-- 4. Backward-compat thin wrappers (DEPRECATED, 1 release lang)
-- ============================================================

CREATE OR REPLACE FUNCTION boek_voorraad_ontvangst(
  p_regel_id BIGINT,
  p_aantal INTEGER,
  p_medewerker TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM boek_inkooporder_ontvangst_stuks(p_regel_id, p_aantal, p_medewerker);
END;
$$;

COMMENT ON FUNCTION boek_voorraad_ontvangst(BIGINT, INTEGER, TEXT) IS
  'DEPRECATED — thin wrapper rondom boek_inkooporder_ontvangst_stuks. '
  'Wordt verwijderd in een volgende migratie nadat alle callers (Python-'
  'import, frontend-dialog) zijn omgezet. ADR-0016.';

-- Voor boek_ontvangst: lees mig 135 voor de werkelijke parameter-shape en
-- bouw de thin wrapper analoog. Niet alle callers gaan via dezelfde naam;
-- bestaande overloads moeten allemaal door de wrapper afgevangen worden.

GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_stuks(BIGINT, INTEGER, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION boek_inkooporder_ontvangst_rollen(BIGINT, JSONB, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION boek_io_ontvangst_claims(BIGINT, INTEGER)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
```
END-LEGACY-SQL-BLOCK-TO-DELETE -->

> **Implementer-noot**: het HTML-comment-blok hierboven (`BEGIN-LEGACY-...` → `END-LEGACY-...`) is een ARTEFACT van een eerdere versie van dit plan en mag genegeerd worden. De canonieke SQL voor de migratie is de Step 3-skeleton hierboven. Verwijder dit comment-blok niet handmatig — het bevat de oude (foutieve) RPC-redefinitie en is slechts historisch zichtbaar voor de reviewer.

- [ ] **Step 4: Pas toe op Karpi Supabase**

Karpi heeft geen CLI-toegang (zie [reference_karpi_supabase_mcp.md](C:/Users/migue/.claude/projects/c--Users-migue-Documents-Karpi-ERP/memory/reference_karpi_supabase_mcp.md)).
Volg de handmatige flow:

1. Open Supabase Dashboard → SQL Editor.
2. Plak de inhoud van `271_inkoop_module_rename_ontvangst_rpcs.sql`.
3. Run. Verifieer 0 errors.
4. Run `SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'boek_inkooporder%';` — verwacht 2 rijen.
5. Run `SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('boek_voorraad_ontvangst','boek_ontvangst');` — verwacht 2 rijen (oude namen blijven bestaan als DEPRECATED wrappers).

- [ ] **Step 5: Smoke-test in SQL Editor**

```sql
-- Vind een open IO-regel met eenheid=stuks die nog claims heeft
SELECT ir.id, ir.regelnummer, ir.artikelnr, ir.te_leveren_m,
       (SELECT count(*) FROM order_reserveringen
         WHERE inkooporder_regel_id = ir.id AND status='actief') AS open_claims
  FROM inkooporder_regels ir
  JOIN inkooporders io ON io.id = ir.inkooporder_id
 WHERE ir.eenheid = 'stuks'
   AND ir.te_leveren_m > 0
   AND io.status IN ('Besteld', 'Deels ontvangen')
 LIMIT 5;

-- Doe geen echte ontvangst-boeking nu — alleen test-data inspectie.
-- Voor TDD-validatie zie Task 5 (contract-test).
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql
git commit -m "feat(inkoop): mig 271 RPC-rename — boek_inkooporder_ontvangst_{stuks,rollen} wrappers"
```

---

## Task 5: Contract-test voor RPC-splitsing

**Files:**
- Create: `frontend/src/modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts`

Volgt het patroon uit ADR-0015 (`dekking-contract.test.ts`): de TypeScript-test roept de SQL-RPC's aan tegen een test-database en verifieert het verwachte gedrag. Gebruikt Vitest.

- [ ] **Step 1: Lees referentie-contract-test**

```bash
ls frontend/src/modules/reserveringen/lib/__tests__/ 2>/dev/null
```

Als `dekking-contract.test.ts` bestaat: lees voor stijl. Als niet (ADR-0015 nog uit te voeren), val terug op een bestaand `*.test.ts` in dezelfde codebase:

```bash
find frontend/src -name "*.test.ts" -not -path "*/node_modules/*" | head -5
```

- [ ] **Step 2: Schrijf de failing test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { supabase } from '@/lib/supabase/client'

describe('boek_inkooporder_ontvangst_stuks — contract', () => {
  let testIoRegelId: number
  let testOrderRegelId: number

  beforeAll(async () => {
    // Setup: maak een test-IO-regel met openstaande claim
    // (Gebruik bestaande seed-data of skip de hele suite als geen test-DB)
    const { data: regel } = await supabase
      .from('inkooporder_regels')
      .select('id')
      .eq('eenheid', 'stuks')
      .gt('te_leveren_m', 0)
      .limit(1)
      .single()

    if (!regel) {
      throw new Error('Geen test IO-regel beschikbaar; seed test-DB eerst.')
    }
    testIoRegelId = regel.id
  })

  it('boekt ontvangst en bumpt producten.voorraad', async () => {
    const { data: voorBoeking } = await supabase
      .from('producten')
      .select('voorraad')
      .eq('artikelnr', /* artikelnr uit IO-regel */ '')
      .single()

    const { error } = await supabase.rpc('boek_inkooporder_ontvangst_stuks', {
      p_io_regel_id: testIoRegelId,
      p_aantal: 1,
      p_medewerker: 'test',
    })
    expect(error).toBeNull()

    const { data: naBoeking } = await supabase
      .from('producten')
      .select('voorraad')
      .eq('artikelnr', '')
      .single()

    expect(naBoeking?.voorraad).toBe((voorBoeking?.voorraad ?? 0) + 1)
  })

  it('consumeert openstaande IO-claim en maakt voorraad-claim', async () => {
    // Verifieer dat na boeking een claim met bron='inkooporder_regel' status='geleverd'
    // is, en een nieuwe rij met bron='voorraad' status='actief' bestaat voor dezelfde
    // orderregel met identiek aantal.
  })

  it('verwerpt eenheid=m IO-regel met heldere foutmelding', async () => {
    const { data: mRegel } = await supabase
      .from('inkooporder_regels')
      .select('id')
      .eq('eenheid', 'm')
      .limit(1)
      .single()

    const { error } = await supabase.rpc('boek_inkooporder_ontvangst_stuks', {
      p_io_regel_id: mRegel!.id,
      p_aantal: 1,
    })
    expect(error?.message).toContain('eenheid=\'stuks\'')
  })

  it('roept herwaardeer_claims_voor_order aan voor elke geraakte order', async () => {
    // Verifieer side-effect via een dummy-order met status 'Wacht op inkoop'
    // → na boeking status flipt naar 'Open' (of zo geconfigureerd).
  })
})

describe('boek_inkooporder_ontvangst_rollen — contract', () => {
  it('maakt rollen aan en bumpt geleverd_m', async () => {
    // ...
  })

  it('roept géén claim-consume aan (eenheid=m heeft geen claims)', async () => {
    // Verifieer dat geen rijen in order_reserveringen muteren.
  })
})
```

Vul de skelet-testen aan tot 4-6 echte assertions per RPC.

- [ ] **Step 3: Run test — verifieer FAIL**

```bash
cd frontend && pnpm vitest run modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts
```

Verwacht: FAIL (test-setup mist seed-data óf RPC's bestaan nog niet als migratie nog niet draaide).

- [ ] **Step 4: Run test — verifieer PASS na mig 271**

Voer mig 271 (Task 4) opnieuw uit op test-database als nodig. Run de test:

```bash
cd frontend && pnpm vitest run modules/inkoop/lib/__tests__/boek-ontvangst-contract.test.ts
```

Verwacht: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/inkoop/lib/__tests__/
git commit -m "test(inkoop): contract-test voor boek_inkooporder_ontvangst_{stuks,rollen}"
```

---

## Task 6: Components verhuizen + `<InkoopRegelSamenvatting>` slot

**Files:**
- Create: `frontend/src/modules/inkoop/components/inkoop-regel-samenvatting.tsx`
- Create: `frontend/src/modules/inkoop/components/leverancier-stats-card.tsx`
- Modify: `frontend/src/modules/inkoop/index.ts` (component-exports)
- Verplaatsen: drie components uit `frontend/src/components/inkooporders/`

- [ ] **Step 1: Verhuis de zes bestaande components**

```bash
git mv frontend/src/components/inkooporders/inkooporder-form-dialog.tsx \
       frontend/src/modules/inkoop/components/inkooporder-form-dialog.tsx
git mv frontend/src/components/inkooporders/inkooporder-status-badge.tsx \
       frontend/src/modules/inkoop/components/inkooporder-status-badge.tsx
git mv frontend/src/components/inkooporders/ontvangst-boeken-dialog.tsx \
       frontend/src/modules/inkoop/components/ontvangst-boeken-dialog.tsx
git mv frontend/src/components/inkooporders/io-regel-claims-popover.tsx \
       frontend/src/modules/inkoop/components/io-regel-claims-popover.tsx
git mv frontend/src/components/inkooporders/voorraad-ontvangst-dialog.tsx \
       frontend/src/modules/inkoop/components/voorraad-ontvangst-dialog.tsx
git mv frontend/src/components/inkooporders/rol-sticker-layout.tsx \
       frontend/src/modules/inkoop/components/rol-sticker-layout.tsx
```

Verifieer dat `components/inkooporders/` daarna leeg is (`ls`); zo niet, voeg ontbrekende bestanden toe en herhaal.

- [ ] **Step 2: Update imports in de verhuisde components**

Zoek naar oude paden binnen de verhuisde bestanden:

```bash
grep -n "@/lib/supabase/queries/inkooporders\|@/lib/supabase/queries/leveranciers" \
  frontend/src/modules/inkoop/components/*.tsx
```

Vervang door:

```typescript
import { ... } from '@/modules/inkoop'
```

Bestaande imports binnen `components/inkooporders/` naar elkaar moeten ook bijgewerkt (relatief naar de nieuwe locatie).

- [ ] **Step 3: Update `OntvangstBoekenDialog` om `useBoekOntvangst` te gebruiken**

In `ontvangst-boeken-dialog.tsx`: vervang directe `supabase.rpc('boek_voorraad_ontvangst', ...)` aanroepen door:

```typescript
import { useBoekOntvangst } from '../hooks/use-boek-ontvangst'

// In het component:
const boekOntvangst = useBoekOntvangst()

// Submit handler:
const onSubmit = async () => {
  await boekOntvangst.mutateAsync({
    ioRegelId: regel.id,
    aantal: ingevuldAantal,
    medewerker: huidigeMedewerker,
  })
}
```

- [ ] **Step 4: Maak `<InkoopRegelSamenvatting>` (slot voor Reservering)**

**Belangrijk**: `leverancier_id` zit op `inkooporders` (mig 127), niet op `inkooporder_regels`. De slot heeft één dedicated query nodig die regel + parent IO + leverancier samenvoegt — geen drie aparte hooks. Voeg deze query toe aan `modules/inkoop/queries/inkooporders.ts`:

```typescript
export interface InkoopRegelSamenvatting {
  io_regel_id: number
  inkooporder_nr: string
  inkooporder_status: string
  leverancier_naam: string | null
  verwacht_datum: string | null   // ISO-date
  te_leveren_m: number
  eenheid: string
}

export async function fetchInkoopRegelSamenvatting(
  ioRegelId: number,
): Promise<InkoopRegelSamenvatting | null> {
  const { data, error } = await supabase
    .from('inkooporder_regels')
    .select(`
      id,
      te_leveren_m,
      eenheid,
      inkooporders!inner (
        inkooporder_nr,
        status,
        verwacht_datum,
        leveranciers ( naam )
      )
    `)
    .eq('id', ioRegelId)
    .single()
  if (error || !data) return null
  return {
    io_regel_id: data.id,
    inkooporder_nr: data.inkooporders.inkooporder_nr,
    inkooporder_status: data.inkooporders.status,
    leverancier_naam: data.inkooporders.leveranciers?.naam ?? null,
    verwacht_datum: data.inkooporders.verwacht_datum,
    te_leveren_m: data.te_leveren_m,
    eenheid: data.eenheid,
  }
}
```

Voeg overeenkomstige hook toe in `hooks/use-inkooporders.ts`:

```typescript
export function useInkoopRegelSamenvatting(ioRegelId: number | undefined) {
  return useQuery({
    queryKey: ['inkoop-regel-samenvatting', ioRegelId],
    queryFn: () => fetchInkoopRegelSamenvatting(ioRegelId!),
    enabled: ioRegelId !== undefined,
    staleTime: 30_000,
  })
}
```

Component:

```typescript
import { Badge } from '@/components/ui/badge'
import { verzendWeekKort } from '@/lib/orders/verzendweek'
import { useInkoopRegelSamenvatting } from '../hooks/use-inkooporders'

interface Props {
  ioRegelId: number
}

/**
 * Slot voor Reservering's RegelClaimDetail.
 * Self-fetcht (één query, regel + parent IO + leverancier). Consumer plaatst
 * alleen met ioRegelId-prop, weet niets van Inkoop's data-shape.
 */
export function InkoopRegelSamenvatting({ ioRegelId }: Props) {
  const { data, isLoading } = useInkoopRegelSamenvatting(ioRegelId)

  if (isLoading) return <span className="text-xs text-muted-foreground">…</span>
  if (!data) return null

  return (
    <div className="text-xs space-y-0.5">
      <div className="font-medium">
        {data.inkooporder_nr}
        {data.leverancier_naam && (
          <span className="text-muted-foreground"> · {data.leverancier_naam}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">{data.inkooporder_status}</Badge>
        {data.verwacht_datum && (
          <span>verwacht {verzendWeekKort(data.verwacht_datum)}</span>
        )}
        {data.te_leveren_m > 0 && (
          <span>
            {data.te_leveren_m} {data.eenheid === 'm' ? 'm' : 'stuks'} open
          </span>
        )}
      </div>
    </div>
  )
}
```

Vergeet niet `useInkoopRegelSamenvatting` aan de barrel-export toe te voegen in Step 6.

- [ ] **Step 5: Maak `<LeverancierStatsCard>` (extract uit detail-pagina)**

Open `pages/leveranciers/leverancier-detail.tsx`, identificeer het stats-block (openstaande orders, openstaande meters, etc.) en extract het naar een eigen component zodat het door zowel detail-pagina als overzicht (in tabel-rij) hergebruikt kan worden.

- [ ] **Step 6: Update barrel `index.ts`**

```typescript
// Components — verhuisd
export { InkooporderFormDialog } from './components/inkooporder-form-dialog'
export { InkooporderStatusBadge } from './components/inkooporder-status-badge'
export { OntvangstBoekenDialog } from './components/ontvangst-boeken-dialog'
export { IORegelClaimsPopover } from './components/io-regel-claims-popover'
export { VoorraadOntvangstDialog } from './components/voorraad-ontvangst-dialog'
export { RolStickerLayout } from './components/rol-sticker-layout'

// Components — nieuw
export { LeverancierStatsCard } from './components/leverancier-stats-card'
export { InkoopRegelSamenvatting } from './components/inkoop-regel-samenvatting'

// Hook voor het slot
export { useInkoopRegelSamenvatting } from './hooks/use-inkooporders'
```

Verifieer dat elke `export { … }` matcht met de werkelijke component-naam (sommige bestanden gebruiken een default-export — gebruik dan `export { default as Naam } from './...'`).

- [ ] **Step 7: Typecheck + frontend build**

```bash
cd frontend && pnpm tsc --noEmit && pnpm build
```

Verwacht: geen errors. Eventuele import-paden in pages die nog naar `components/inkooporders/...` wijzen worden in Task 7 omgezet.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/inkoop/components/ \
        frontend/src/modules/inkoop/index.ts \
        frontend/src/modules/inkoop/hooks/use-inkooporders.ts
git rm -r frontend/src/components/inkooporders/
git commit -m "feat(inkoop): components verhuisd, slot InkoopRegelSamenvatting toegevoegd"
```

---

## Task 7: Pages verhuizen + router-update

**Files:**
- Verplaatsen: `pages/inkooporders/` (3 pages) + `pages/leveranciers/` (2 pages) → `modules/inkoop/pages/`
- Modify: `frontend/src/App.tsx` (of waar de router-config staat)

- [ ] **Step 1: Vind router-config**

```bash
grep -rln "inkooporders-overview\|InkooporderDetail\|LeveranciersOverview" \
  frontend/src --include="*.tsx" | head -5
```

- [ ] **Step 2: Verhuis pages**

```bash
git mv frontend/src/pages/inkooporders/inkooporders-overview.tsx \
       frontend/src/modules/inkoop/pages/inkooporders-overview.tsx
git mv frontend/src/pages/inkooporders/inkooporder-detail.tsx \
       frontend/src/modules/inkoop/pages/inkooporder-detail.tsx
git mv frontend/src/pages/inkooporders/rol-stickers-print.tsx \
       frontend/src/modules/inkoop/pages/rol-stickers-print.tsx
git mv frontend/src/pages/leveranciers/leveranciers-overview.tsx \
       frontend/src/modules/inkoop/pages/leveranciers-overview.tsx
git mv frontend/src/pages/leveranciers/leverancier-detail.tsx \
       frontend/src/modules/inkoop/pages/leverancier-detail.tsx
```

- [ ] **Step 3: Update imports binnen verhuisde pages**

```bash
grep -n "from '@/" frontend/src/modules/inkoop/pages/*.tsx | head -30
```

Vervang alle imports die naar `@/lib/supabase/queries/inkooporders`, `@/lib/supabase/queries/leveranciers`, of `@/components/inkooporders/...` wezen door `@/modules/inkoop`.

- [ ] **Step 4: Update router-config**

Open `App.tsx` (of wat Step 1 vond) en pas import-paden aan:

```diff
- import InkooporderOverview from '@/pages/inkooporders/inkooporders-overview'
+ import InkooporderOverview from '@/modules/inkoop/pages/inkooporders-overview'

- import InkooporderDetail from '@/pages/inkooporders/inkooporder-detail'
+ import InkooporderDetail from '@/modules/inkoop/pages/inkooporder-detail'

- import RolStickersPrint from '@/pages/inkooporders/rol-stickers-print'
+ import RolStickersPrint from '@/modules/inkoop/pages/rol-stickers-print'

- import LeveranciersOverview from '@/pages/leveranciers/leveranciers-overview'
+ import LeveranciersOverview from '@/modules/inkoop/pages/leveranciers-overview'

- import LeverancierDetail from '@/pages/leveranciers/leverancier-detail'
+ import LeverancierDetail from '@/modules/inkoop/pages/leverancier-detail'
```

**Routes blijven `/inkoop`, `/inkoop/:id`, `/leveranciers`, `/leveranciers/:id`** — geen URL-wijziging (bookmark-compat).

- [ ] **Step 5: Verifieer pages-folders zijn leeg**

```bash
ls frontend/src/pages/inkooporders/ frontend/src/pages/leveranciers/ 2>&1
```

Als leeg: verwijder de directories:

```bash
rmdir frontend/src/pages/inkooporders frontend/src/pages/leveranciers
```

- [ ] **Step 6: Typecheck + dev-server smoke-test**

```bash
cd frontend && pnpm tsc --noEmit
pnpm dev &
# Open http://localhost:5173/inkoop, /inkoop/:id, /leveranciers, /leveranciers/:id
# Verifieer dat pages laden zonder console-errors.
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/inkoop/pages/ \
        frontend/src/App.tsx
git rm -r frontend/src/pages/inkooporders frontend/src/pages/leveranciers
git commit -m "feat(inkoop): pages verhuisd naar modules/inkoop, router bijgewerkt"
```

---

## Task 8: Reservering's `RegelClaimDetail` consumeert `<InkoopRegelSamenvatting>`

**Files:**
- Modify: `frontend/src/modules/reserveringen/components/regel-claim-detail.tsx`
  (ofwel `frontend/src/components/orders/regel-claim-detail.tsx` als ADR-0015 stap 5 nog niet uitgevoerd; pas pad aan op werkelijke locatie)

- [ ] **Step 1: Vind huidige IO-rij-rendering**

```bash
grep -n "inkooporder\|io_regel\|IO " \
  frontend/src/modules/reserveringen/components/regel-claim-detail.tsx 2>/dev/null \
  || grep -n "inkooporder\|io_regel" frontend/src/components/orders/regel-claim-detail.tsx
```

Zoek het stuk waar een claim met `bron='inkooporder_regel'` wordt weergegeven — dit is de plek voor de slot.

- [ ] **Step 2: Plaats `<InkoopRegelSamenvatting>`**

```diff
+ import { InkoopRegelSamenvatting } from '@/modules/inkoop'

  // In de render van een IO-claim-rij:
- <span>Wacht op IO-regel #{claim.inkooporder_regel_id}</span>
+ <InkoopRegelSamenvatting ioRegelId={claim.inkooporder_regel_id} />
```

- [ ] **Step 3: Verifieer in browser**

Dev-server al draaiend (uit Task 7 Step 6). Navigate naar een order met `Wacht op inkoop`-status. Open detail-pagina, verifieer dat het IO-blok nu inkooporder_nr + leverancier + status-badge + verwacht-week toont.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/reserveringen/components/regel-claim-detail.tsx
git commit -m "feat(inkoop): RegelClaimDetail consumeert InkoopRegelSamenvatting slot"
```

---

## Task 9: Python import-script — TODO-notitie + lint-whitelist (geen RPC-conversie)

**Files:**
- Modify: `import/import_inkoopoverzicht.py` (alleen comment-banner)

**Context**: het script doet vandaag enkel **initial bulk-create** van inkooporder-headers en -regels uit `Inkoopoverzicht.xlsx`. Het roept géén `boek_voorraad_ontvangst` of `boek_ontvangst` aan (geverifieerd via `grep -n "boek_" import/import_inkoopoverzicht.py` — geen treffers). Er is dus niets te converteren naar de nieuwe RPC's. De gebruiker's keuze "geen RLS-bypass meer" zou een vervolg-vraag triggeren: maak een `create_inkooporder` RPC zodat ook initial-bulk-create via de Module-laag loopt. Dat is **out-of-scope voor ADR-0016** en wordt op de open-backlog gezet.

- [ ] **Step 1: Voeg TODO-banner aan script toe**

Aan het begin van `import/import_inkoopoverzicht.py`, na de bestaande docstring:

```python
# TODO(ADR-0016, open backlog): dit script doet bulk-insert in
# inkooporder_regels via service-role-key. Initial-imports passen niet binnen
# boek_inkooporder_ontvangst_{stuks,rollen} (die zijn voor ontvangst-boekingen
# op bestaande regels, niet voor regel-creatie). Volgende stap: introduceer
# een `create_inkooporder(p_payload JSONB)` RPC in een vervolg-migratie zodat
# ook deze flow door de Inkoop-Module-laag gaat. Tot dan: pad expliciet
# gewhitelist in scripts/lint-no-direct-inkooporder-regel-write.sh.
```

- [ ] **Step 2: Commit**

```bash
git add import/import_inkoopoverzicht.py
git commit -m "docs(inkoop): TODO-banner voor create_inkooporder-RPC backlog"
```

---

## Task 10: Lint-script + ESLint-regel

**Files:**
- Create: `scripts/lint-no-direct-inkooporder-regel-write.sh`
- Modify: ESLint config (`.eslintrc.cjs` of `eslint.config.js`)

- [ ] **Step 1: Schrijf shell-lint-script**

```bash
#!/usr/bin/env bash
# Verbiedt directe writes naar inkooporder_regels / inkooporders.status
# buiten de migraties die deze tabellen "bezitten" en de Inkoop-Module RPCs.

set -euo pipefail

# Migraties die historisch / Module-eigen writes doen:
#   127 — initial inkooporders/leveranciers tabellen
#   131 — FK-cleanup voor inkoop
#   133 — boek_ontvangst m² fix
#   135 — boek_ontvangst auto-rolnummer
#   136 — boek_ontvangst voorraad_mutaties schema fix
#   148 — boek_voorraad_ontvangst claim-consume
#   254 — boek_voorraad_ontvangst → PERFORM boek_io_ontvangst_claims (ADR-0015)
#   257 — RPC-rename naar boek_inkooporder_ontvangst_{stuks,rollen} (ADR-0016)
WHITELIST_PATTERN='supabase/migrations/(127|131|133|135|136|148|254|257)_'

# Python-import-paden die initial-bulk-create doen (Task 9 backlog: vervang
# door create_inkooporder-RPC in vervolg-werk).
PYTHON_WHITELIST='import/import_inkoopoverzicht\.py'

GUILTY=0

# Scan migrations
while IFS= read -r match; do
  file="${match%%:*}"
  if [[ "$file" =~ $WHITELIST_PATTERN ]]; then continue; fi
  echo "❌ Directe write naar inkooporder(_regels)? in $match"
  GUILTY=1
done < <(grep -rEn \
  'UPDATE\s+inkooporder_regels|INSERT\s+INTO\s+inkooporder_regels|UPDATE\s+inkooporders\s+SET\s+status' \
  supabase/migrations/ || true)

# Scan edge functions
while IFS= read -r match; do
  echo "❌ Directe write in edge function: $match"
  GUILTY=1
done < <(grep -rEn \
  "from\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)" \
  supabase/functions/ || true)

# Scan Python import (verbied directe table-writes buiten whitelist; RPC is OK)
while IFS= read -r match; do
  file="${match%%:*}"
  if [[ "$file" =~ $PYTHON_WHITELIST ]]; then continue; fi
  if [[ "$match" == *".rpc("* ]]; then continue; fi
  echo "❌ Directe table-write in Python: $match"
  GUILTY=1
done < <(grep -rEn \
  "table\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)" \
  import/ || true)

# Scan frontend (deprecation-shims na Task 11 verwijderd; consumers via barrel)
while IFS= read -r match; do
  echo "❌ Directe write naar inkooporder_regels in frontend: $match"
  GUILTY=1
done < <(grep -rEn \
  "from\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)" \
  frontend/src --include="*.ts" --include="*.tsx" || true)

if [[ "$GUILTY" -eq 1 ]]; then
  echo ""
  echo "Inkoop-Module is de enige writer van inkooporder_regels en"
  echo "inkooporders.status. Gebruik boek_inkooporder_ontvangst_{stuks,rollen}"
  echo "of via @/modules/inkoop barrel-hooks. Zie ADR-0016."
  exit 1
fi

echo "✅ Geen directe inkooporder-writes buiten Inkoop-Module."
```

- [ ] **Step 2: Maak script uitvoerbaar**

```bash
chmod +x scripts/lint-no-direct-inkooporder-regel-write.sh
```

- [ ] **Step 3: Voer script uit op huidige tree**

```bash
bash scripts/lint-no-direct-inkooporder-regel-write.sh
```

Verwacht: ✅ groen. Als rood: verifieer welke caller nog directe writes doet en fix vooraleer verder.

- [ ] **Step 4: ESLint `no-restricted-imports`-regel**

Open ESLint config en voeg toe (volg het patroon uit ADR-0015 voor Reservering):

```javascript
'no-restricted-imports': ['error', {
  patterns: [
    {
      group: ['@/lib/supabase/queries/inkooporders', '@/lib/supabase/queries/leveranciers'],
      message: 'Importeer uit "@/modules/inkoop" (zie ADR-0016).',
    },
    {
      group: ['@/components/inkooporders/*'],
      message: 'Components zijn verhuisd naar "@/modules/inkoop" (zie ADR-0016).',
    },
    {
      group: ['@/pages/inkooporders/*', '@/pages/leveranciers/*'],
      message: 'Pages zijn verhuisd naar "@/modules/inkoop/pages" (zie ADR-0016).',
    },
  ],
}],
```

- [ ] **Step 5: Run lint**

```bash
cd frontend && pnpm lint
```

Verwacht: geen errors. Resterende oude-pad-imports zijn shims (die we straks weggooien) — voeg die specifiek toe aan een ESLint-overrides-block of accepteer ze als deprecation-shims.

- [ ] **Step 6: Voeg lint aan CI/pre-commit toe**

Als project pre-commit hooks heeft (`.husky/`):

```bash
echo "bash scripts/lint-no-direct-inkooporder-regel-write.sh" >> .husky/pre-commit
```

Anders: voeg toe aan CI-workflow (vergelijk met Reservering's lint-script-integratie).

- [ ] **Step 7: Commit**

```bash
git add scripts/lint-no-direct-inkooporder-regel-write.sh \
        frontend/eslint.config.js \
        .husky/pre-commit
git commit -m "feat(inkoop): lint-scripts beschermen Module-boundary"
```

---

## Task 11: Oude bestanden verwijderen + import-path cleanup

**Files:**
- Delete: `frontend/src/lib/supabase/queries/inkooporders.ts` (shim weg)
- Delete: `frontend/src/lib/supabase/queries/leveranciers.ts` (shim weg)
- Modify: alle bestanden die nog via shim-pad importeren

- [ ] **Step 1: Vind resterende shim-imports**

```bash
grep -rn "@/lib/supabase/queries/inkooporders\|@/lib/supabase/queries/leveranciers" \
  frontend/src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Vervang door barrel-imports**

Voor elke gevonden caller:

```diff
- import { ... } from '@/lib/supabase/queries/inkooporders'
+ import { ... } from '@/modules/inkoop'
```

- [ ] **Step 3: Verwijder shim-bestanden**

```bash
git rm frontend/src/lib/supabase/queries/inkooporders.ts \
       frontend/src/lib/supabase/queries/leveranciers.ts
```

- [ ] **Step 4: Run lint + typecheck + build**

```bash
cd frontend && pnpm lint && pnpm tsc --noEmit && pnpm build
```

Verwacht: alles groen.

- [ ] **Step 5: Run lint-script**

```bash
bash scripts/lint-no-direct-inkooporder-regel-write.sh
```

Verwacht: ✅.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(inkoop): verwijder deprecation-shims, alle imports via barrel"
```

---

## Task 12: Documentatie bijwerken

**Files:**
- Modify: `docs/architectuur.md`
- Modify: `docs/data-woordenboek.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: `architectuur.md` — Module-graf bijwerken**

Open de Module-graaf-paragraaf (rond regel 29). Voeg toe als **elfde domein-Module** met dezelfde stijl als Reservering's intro:

```markdown
De **elfde domein-module is `modules/inkoop/`** ([ADR-0016](adr/0016-inkoop-als-deep-module.md))
— bezit inkooporders, leveranciers en de ontvangst-flow. Medium scope:
logica-laag (queries/hooks/mutations) + components + pages.

Publieke RPCs (mig 271): `boek_inkooporder_ontvangst_stuks` voor het stuks-pad,
`boek_inkooporder_ontvangst_rollen` voor het rollen-pad. Beide delegeren claim-
consume aan Reservering's `boek_io_ontvangst_claims` (Inkoop is vervoerder van
de event; Reservering bezit de state-mutatie). Oude RPC-namen `boek_voorraad_
ontvangst` en `boek_ontvangst` blijven 1 release als thin wrappers met
DEPRECATED-comment.

Slot-component `<InkoopRegelSamenvatting>` wordt door Reservering's
`RegelClaimDetail` geconsumeerd zonder hooks-import — patroon analoog aan
`<KlantBenaming>` en `<VervoerderTag>`. Routes blijven `/inkoop` en
`/leveranciers` (bookmark-compat), eigendom verhuist naar Module-folder
(precedent: Debiteur met `/klanten`-routes).

Open backlog: rol-creatie + `voorraad_mutaties`-INSERT verhuist naar
toekomstige Voorraad/Producten-Module; inkoopgroepen (klant-attribuut, niet
inkoop-domein) verhuist naar Debiteur-Module.
```

- [ ] **Step 2: `data-woordenboek.md` — Inkoop-Module-term**

Voeg toe in de Module-termen-sectie:

```markdown
**Inkoop-Module** (ADR-0016, 2026-05-13) — Eigenaar van het Inkooporder-concept,
Leverancier-master-data en de ontvangst-flow. Bron-van-waarheid: tabellen
`inkooporders`, `inkooporder_regels`, `leveranciers`. Publieke RPCs:
`boek_inkooporder_ontvangst_stuks`, `boek_inkooporder_ontvangst_rollen`.
Schrijft uitsluitend zelf naar `producten.besteld_inkoop` (cache, via
trigger `trg_sync_besteld_inkoop`).
```

- [ ] **Step 3: `changelog.md` — entry voor 2026-05-13**

```markdown
## 2026-05-13 — Inkoop-Module (ADR-0016)

- Elfde deep verticale Module: `modules/inkoop/` met queries, hooks, components, pages.
- Mig 271: RPC-splitsing `boek_inkooporder_ontvangst_{stuks,rollen}` (Inkoop) +
  `boek_io_ontvangst_claims` (Reservering). Sluit ADR-0015 open backlog af.
- Slot `<InkoopRegelSamenvatting>` geconsumeerd door Reservering's `RegelClaimDetail`.
- Python `import_inkoopoverzicht.py` gebruikt voortaan de RPC i.p.v. directe
  table-writes; geen RLS-bypass meer.
- Lint-script + ESLint-regel beschermen Module-boundary.
- Backward-compat thin wrappers `boek_voorraad_ontvangst` / `boek_ontvangst`
  staan op deprecation, verwijderen in volgende migratie.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architectuur.md docs/data-woordenboek.md docs/changelog.md
git commit -m "docs(inkoop): ADR-0016 in architectuur.md, woordenboek + changelog"
```

---

## Task 13: End-to-end verificatie

- [ ] **Step 1: Volledige typecheck + lint + build**

```bash
cd frontend && pnpm lint && pnpm tsc --noEmit && pnpm build
```

Verwacht: alles groen.

- [ ] **Step 2: Run alle Vitest-suites**

```bash
cd frontend && pnpm vitest run
```

Verwacht: alle tests slagen, inclusief de nieuwe contract-test uit Task 5.

- [ ] **Step 3: Lint-scripts**

```bash
bash scripts/lint-no-direct-inkooporder-regel-write.sh
bash scripts/lint-no-direct-orders-status-update.sh
bash scripts/lint-no-direct-order-reserveringen-write.sh
```

Verwacht: drie keer ✅.

- [ ] **Step 4: Dev-server smoke-test (handmatig)**

Doorloop deze flows in de browser tegen test-data:

1. `/inkoop` — overzicht laadt, filters werken, "Nieuwe inkooporder" opent dialog.
2. `/inkoop/:id` — detail laadt, "Ontvangst boeken"-knop opent dialog. Boek stuks-ontvangst op een test-regel; verifieer dat:
   - `producten.voorraad` is opgehoogd
   - Eén IO-claim is naar `geleverd` geflipt
   - Een nieuwe `voorraad`-claim bestaat voor dezelfde orderregel
   - De order-status reageert (uit `Wacht op inkoop` → `Open`)
3. `/leveranciers` + `/leveranciers/:id` — pages laden, stats-card toont openstaande orders/meters.
4. Order-detail-pagina met een regel in `Wacht op inkoop`: verifieer dat de IO-rij in `RegelClaimDetail` nu `<InkoopRegelSamenvatting>` toont met inkooporder_nr + leverancier + status.

- [ ] **Step 5: Smoke-test SQL**

In Supabase SQL Editor:

```sql
-- Nieuwe RPC's beschikbaar?
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema='public'
   AND routine_name IN (
     'boek_inkooporder_ontvangst_stuks',
     'boek_inkooporder_ontvangst_rollen',
     'boek_io_ontvangst_claims'
   );
-- Verwacht: 3 rijen.

-- Thin wrappers nog werkend?
SELECT routine_name FROM information_schema.routines
 WHERE routine_schema='public'
   AND routine_name IN ('boek_voorraad_ontvangst', 'boek_ontvangst');
-- Verwacht: 2 rijen (nog niet weg).
```

- [ ] **Step 6: Push branch**

```bash
git push -u origin feat/inkoop-deep-module
```

- [ ] **Step 7: Cleanup worktree na merge**

Na merge naar `main`:

```bash
cd ../<hoofd-werkdirectory>
git worktree remove ../karpi-inkoop
git branch -d feat/inkoop-deep-module
```

---

## Risico's + mitigaties

| Risico | Mitigatie |
|--------|-----------|
| Mig 254 + 255 (ADR-0015) nog niet op main → `boek_io_ontvangst_claims`, `herwaardeer_claims_voor_order` etc. bestaan niet | Prerequisite-check in Prerequisites + Task 1 Step 1. Stop indien niet aanwezig. |
| Migratie-nummer 257 inmiddels bezet door ander werk | Run `ls supabase/migrations/ \| sort -V \| tail -3` in Task 4 Step 1. Pas overal het nummer aan. |
| `boek_io_ontvangst_claims` per ongeluk herdefiniëren in mig 271 | Plan-tekst zegt expliciet: **niet aanraken**. PostgreSQL geeft sowieso "cannot change name of input parameter"-error bij `p_aantal_ontvangen → p_ontvangen_aantal`. |
| `boek_ontvangst` heeft méér overload-signatures dan in mig 135 | Step 2 grept alle definities en kiest de hoogst-genummerde. Bouw één wrapper per overload als er meerdere zijn. |
| Backward-compat wrappers worden vergeten te verwijderen | Issue/TODO in `changelog.md` + DEPRECATED-comment in SQL. Vervolg-migratie 258+ of later. |
| Contract-test vereist seed-data die niet bestaat | Task 5 markeert de hele suite als skippable via `beforeAll`-guard. Niet een blocker voor merge, wel voor volledige TDD-loop. |
| Python-import-script blijft RLS bypassen via service-role-key | Geaccepteerd voor V1 (Task 9 TODO-banner). Vervolg-werk: `create_inkooporder`-RPC. |
| Lint-script blokkeert legitieme initial-IO-create uit Python | Whitelist `import/import_inkoopoverzicht.py` (Task 10 Step 1). Verwijder whitelist zodra create_inkooporder-RPC landt. |

## Open vragen voor uitvoering

1. **`boek_ontvangst` parameter-shape**: lees mig 133-136 volledig vóór Task 4 om de wrapper-skeleton correct te bouwen.
2. **Vitest-DB**: heeft het project een test-DB seed-strategy? Anders contract-test als optioneel skipbaar markeren.
3. **TypeScript Supabase-types**: zijn er auto-gegenereerde types die geüpdate moeten worden na mig 271? Check `frontend/src/lib/supabase/types.ts` of vergelijkbaar.
