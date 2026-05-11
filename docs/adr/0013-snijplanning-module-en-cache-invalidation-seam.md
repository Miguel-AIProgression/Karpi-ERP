---
status: accepted
date: 2026-05-11
---

# Snijplanning als deep Module + cross-Module cache-invalidation seam via per-Module helpers

## Context

De Snijplanning-flow (Wacht → Gepland → Snijden → Gesneden → In confectie → Ingepakt) is de oudste en meest gemuteerde productie-flow in de app. Anders dan de andere negen Modules leeft hij verspreid, zonder eigen folder of barrel:

- [`hooks/use-snijplanning.ts`](../../frontend/src/hooks/use-snijplanning.ts) — 392 regels, 19 hooks (queries + mutations + auto-planning)
- [`lib/supabase/queries/snijplanning.ts`](../../frontend/src/lib/supabase/queries/snijplanning.ts) — 296 regels (queries op `snijplanning_overzicht`, `productie_dashboard`)
- [`lib/supabase/queries/snijplanning-mutations.ts`](../../frontend/src/lib/supabase/queries/snijplanning-mutations.ts) — 88 regels (status-mutaties)
- [`lib/supabase/queries/snijvoorstel.ts`](../../frontend/src/lib/supabase/queries/snijvoorstel.ts) — 302 regels (snijvoorstel-flow + `voltooi_snijplan_rol`)
- [`lib/supabase/queries/auto-planning.ts`](../../frontend/src/lib/supabase/queries/auto-planning.ts) — 77 regels (auto-planning-config)
- [`lib/utils/compute-reststukken.ts`](../../frontend/src/lib/utils/compute-reststukken.ts) — 304 regels (reststuk/aangebroken/afval-geometrie)
- [`lib/utils/snijplan-mapping.ts`](../../frontend/src/lib/utils/snijplan-mapping.ts) — 185 regels (snijplan → SVG-stuk-mapping)
- [`lib/snij-volgorde/{derive,types}.ts`](../../frontend/src/lib/snij-volgorde/) — 258 + 86 regels (snij-volgorde-derivatie + test)
- [`components/snijplanning/`](../../frontend/src/components/snijplanning/) — 8 components incl. `RolUitvoerModal` (672 regels)
- [`pages/snijplanning/`](../../frontend/src/pages/snijplanning/) — 7 pages

Totaal ±2.3k regels logica zonder Module-grens. [`docs/architectuur.md:29`](../architectuur.md#L29) pretendeert dat `modules/planning/` snijplanning + confectie + levertijd-simulatie bezit, maar die folder bestaat niet — Confectie verhuisde in [`f508139`](../../frontend/src/modules/confectie/) naar `modules/confectie/` (solo Module #9), Maatwerk naar `modules/maatwerk/` (ADR-0009), Debiteuren naar `modules/debiteuren/` (ADR-0011). De `planning/`-belofte is dode tekst.

### Bug-trigger (2026-05-11)

[`useVoltooiSnijplanRol`](../../frontend/src/hooks/use-snijplanning.ts#L307-L318) invalidate't `['snijplanning']`, `['productie','dashboard']`, `['rollen']` — maar niet `['confectie','planning-forward']`. Na "Rol afsluiten" verdwijnen items uit de snijplanning-pagina, maar verschijnen ze niet onder "Klaar voor confectie" in [`confectie-overview.tsx`](../../frontend/src/pages/confectie/confectie-overview.tsx) tot de 30s-staleTime of een hard-reload.

Dit is geen toevallige vergetelheid: 13 mutation-hooks in `use-snijplanning.ts` somen elk handgeschreven hun consumer-keys op. Hetzelfde patroon overal: [`use-confectie-planning.ts:31-32`](../../frontend/src/modules/confectie/hooks/use-confectie-planning.ts#L31-L32), [`use-confectie.ts:53-87`](../../frontend/src/modules/confectie/hooks/use-confectie.ts#L53-L87), [`use-scanstation.ts:35-38`](../../frontend/src/hooks/use-scanstation.ts#L35-L38). Producer kent consumer. Elke nieuwe consumer (volgende Module) eist edits op N producers — fout-magneet by design.

Deletion-test op [`use-snijplanning.ts`](../../frontend/src/hooks/use-snijplanning.ts): complexiteit zou versnipperen over alle pages/components die hooks consumeren. Het IS earning its keep, maar zit op de verkeerde plek — geen Module-eigenaar.

## Beslissing

Twee samenhangende ingrepen in één PR.

### Ingreep 1 — Maak `modules/snijplanning/` als deep verticale Module (medium scope)

Folder `modules/snijplanning/`, term **Snijplanning-Module**, naam DB-aligned (tabel `snijplannen`).

**Scope (volgt Maatwerk-precedent ADR-0009):** logica-laag verhuist; runtime-components en pages blijven fysiek en consumeren via barrel.

De Module bezit:
- **Queries** voor `snijplanning_overzicht`, `productie_dashboard`, `snijvoorstel`, `auto-planning`-config, rol-snijstukken, rol-locaties, tekort-analyse
- **Mutations** voor snijplan-CRUD, status-update, rol-toewijzing, snijvoorstel-flow, `voltooi_snijplan_rol`, `start_snijden_rol`, `pauzeer_snijden_rol`, auto-plan-trigger, productie-rol-start
- **Lib-helpers** voor reststuk/aangebroken/afval-geometrie, snijplan→SVG-stuk-mapping, snij-volgorde-derivatie
- **Cache.ts** met publieke invalidation-helpers (zie Ingreep 2)

De Module bezit **niet**:
- **Runtime-components** ([`components/snijplanning/`](../../frontend/src/components/snijplanning/)) — blijven fysiek, consumeren via barrel. Kandidaat voor toekomstige decompositie (zie ADR-0009 voor `RolUitvoerModal` als losse vervolg-deepening).
- **Pages** ([`pages/snijplanning/`](../../frontend/src/pages/snijplanning/)) — blijven fysiek, consumeren via barrel. Router-paden onveranderd.
- **SQL** — views (`snijplanning_overzicht`, `confectie_planning_forward`, `productie_dashboard`) en RPCs (`voltooi_snijplan_rol`, `start_snijden_rol`, etc.) blijven SQL-only. Geen migratie nodig voor deze Module-verhuizing.

**Cross-cut behoud:**
- `stuk_snij_marge_cm` (mig 126) blijft cross-cut tussen Maatwerk en Snijplanning. View-kolommen `marge_cm`/`placed_*` op `snijplanning_overzicht` (mig 233) blijven gemeenschappelijke bron-van-waarheid.
- `confectie_planning_forward` (mig 098/243) joint over `snijplannen`-tabel; eigendom blijft bij Confectie-Module (zij filtert/leest het), Snijplanning schrijft alleen status.

### Ingreep 2 — Cross-Module cache-invalidation seam via per-Module `cache.ts`-helpers

Elke Module die naar buiten consumeerbare cache-keys heeft, exporteert **één publieke `invalidateNa<Domein>Mutatie(qc)`-helper** via z'n barrel.

Voorbeeld-contract:

```ts
// modules/snijplanning/cache.ts
import type { QueryClient } from '@tanstack/react-query'

/**
 * Invalidate alle Snijplanning-Module query-keys. Roep aan na elke mutatie
 * die snijplan-rijen of rollen raakt. Andere Modules invalidaten hun eigen
 * keys via hun eigen `cache.ts`-helper.
 */
export function invalidateNaSnijplanMutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['snijplanning'] })
  qc.invalidateQueries({ queryKey: ['snijvoorstel'] })
  qc.invalidateQueries({ queryKey: ['rollen'] })
  qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
}
```

```ts
// modules/confectie/cache.ts
export function invalidateNaConfectieMutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['confectie'] })
  qc.invalidateQueries({ queryKey: ['confectie-planning'] })
  qc.invalidateQueries({ queryKey: ['confectie-werktijden'] })
}
```

**Producer-zijde:** mutation-hooks importeren hun eigen Module-helper plus de helpers van alle Modules die op deze mutatie reageren:

```ts
// modules/snijplanning/hooks/use-snijplanning.ts
import { invalidateNaSnijplanMutatie } from '../cache'
import { invalidateNaConfectieMutatie } from '@/modules/confectie'

export function useVoltooiSnijplanRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: voltooiSnijplanRol,
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc) // status → 'Gesneden' maakt stuk klaar voor confectie
    },
  })
}
```

**Eigenschappen van deze seam:**

- **Depth = leverage:** één korte interface per Module (één publieke functie) achter een ondoorzichtige set van query-keys. Consumers zien alleen de naam.
- **Locality:** elke Module bezit z'n eigen keys. Een nieuwe query-key in Confectie? Eén edit in `modules/confectie/cache.ts` — alle producers krijgen 'm gratis mee.
- **Type-safe:** geen runtime-registry, geen string-events, geen subscriber-lifetime-management.
- **Grep-baar:** "wie reageert op snijplan-mutatie?" = `grep invalidateNaSnijplanMutatie` of `grep invalidateNaConfectieMutatie` in `modules/snijplanning/`-mutaties.
- **Producer kent expliciet consumer:** Snijplanning weet dat Confectie wil reageren. Dat is geen lek — het is de domein-realiteit dat een snijplan-status-mutatie nu eenmaal de confectie-lijst beïnvloedt. Een event-bus zou die realiteit verstoppen achter indirectie zonder iets te winnen.

### Module-Interface (publieke barrel)

`modules/snijplanning/index.ts` exporteert:

**Hooks (queries):** `useSnijplanningPool`, `useSnijplanningGroepen`, `useSnijplannenVoorGroep`, `useSnijplanningStatusCounts`, `useSnijplanDetail`, `useRolSnijstukken`, `useBeschikbareRollen`, `useProductieDashboard`, `useSnijplanningKpis`, `useAlleSnijden`, `useRolLocaties`, `useTekortAnalyse`, `useSnijvoorstel`, `useBeschikbareCapaciteit`, `useGoedgekeurdVoorstel`, `useAutoplanningConfig`.

**Hooks (mutations):** `useCreateSnijplan`, `useUpdateSnijplanStatus`, `useBatchUpdateSnijplanStatus`, `useAssignRol`, `useApproveSnijvoorstel`, `useGenereerSnijvoorstel`, `useKeurSnijvoorstelGoed`, `useVerwerpSnijvoorstel`, `useVoltooiSnijplanRol`, `useStartSnijdenRol`, `usePauzeerSnijdenRol`, `useUpdateAutoplanningConfig`, `useTriggerAutoplan`, `useStartProductieRol`.

**Cache:** `invalidateNaSnijplanMutatie(qc)` — voor cross-Module-producers.

**Lib (pure):** `mapSnijplannenToStukken`, `computeReststukkenAngebrokenAfval`, `buildSnijVolgorde`, types uit `snij-volgorde/types`.

**Types:** `SnijplanSortField`, `SortDirection`, `TekortAnalyseRow`, `SnijplanFormData`, `ReststukResult`, `AutoPlanningConfig`, `CreateSnijplanData`.

Geen barrel-export van losse query-functies (`fetchSnijplanDetail`, etc.) — alleen hooks naar buiten, zodat alle frontend-callers via React Query gaan.

### Frontend-folder-structuur

```
frontend/src/modules/snijplanning/
├── index.ts                                ← barrel
├── cache.ts                                ← invalidateNaSnijplanMutatie (NIEUW)
├── hooks/
│   └── use-snijplanning.ts                 ← van hooks/use-snijplanning.ts
├── queries/
│   ├── snijplanning.ts                     ← van lib/supabase/queries/snijplanning.ts
│   ├── snijplanning-mutations.ts           ← van lib/supabase/queries/snijplanning-mutations.ts
│   ├── snijvoorstel.ts                     ← van lib/supabase/queries/snijvoorstel.ts
│   └── auto-planning.ts                    ← van lib/supabase/queries/auto-planning.ts
└── lib/
    ├── compute-reststukken.ts              ← van lib/utils/compute-reststukken.ts
    ├── snijplan-mapping.ts                 ← van lib/utils/snijplan-mapping.ts
    └── snij-volgorde/
        ├── derive.ts                       ← van lib/snij-volgorde/derive.ts
        ├── types.ts                        ← van lib/snij-volgorde/types.ts
        └── __tests__/derive.test.ts        ← van lib/snij-volgorde/derive.test.ts
```

`modules/confectie/cache.ts` wordt nieuw aangemaakt naast de bestaande Module-struktuur.

### Migratiepad

Conform user-feedback "Na ADR direct stap 1/N committen; niet stapelen zonder code-werk": **ADR + alle stappen in één PR/commit**, niet eerst ADR los committen. Volgt Debiteur-Module-precedent ([2026-05-08 changelog](../changelog.md)).

1. **Stap 1 — Module-skelet:** folder + lege barrel + `cache.ts` met `invalidateNaSnijplanMutatie`.
2. **Stap 2 — Queries verhuizen:** vier query-bestanden naar `modules/snijplanning/queries/`.
3. **Stap 3 — Lib verhuizen:** `compute-reststukken`, `snijplan-mapping`, `snij-volgorde/` (incl. test) naar `modules/snijplanning/lib/`.
4. **Stap 4 — Hook verhuizen + cache-helpers integreren:** `use-snijplanning.ts` naar `modules/snijplanning/hooks/`; alle 13 `invalidateQueries`-blokken vervangen door `invalidateNaSnijplanMutatie(qc)` + cross-Module-aanroepen (vooral `invalidateNaConfectieMutatie` op alle status-mutaties — **lost vandaag's bug op**).
5. **Stap 5 — Confectie-cache toevoegen:** `modules/confectie/cache.ts` aanmaken met `invalidateNaConfectieMutatie`; `use-confectie.ts` en `use-confectie-planning.ts` mutaties refactoren om de helper te gebruiken.
6. **Stap 6 — Scanstation-hook updaten:** `use-scanstation.ts` `useOpboekenItem` gebruikt voortaan beide Module-helpers (snijplanning + confectie).
7. **Stap 7 — Callers naar barrels:** 16+ files die uit oude paden importeerden switchen naar `@/modules/snijplanning`-barrel.
8. **Stap 8 — ESLint regressie-regel:** `no-restricted-imports` voor oude paden met ADR-0013-verwijzing.
9. **Stap 9 — Oude bestanden verwijderen:** 8 oude bestanden weg.
10. **Stap 10 — Docs:** `architectuur.md` (Module-graf-paragraaf — tiende Module + `planning/`-belofte ingetrokken), `data-woordenboek.md` (Snijplanning-Module-term), `changelog.md`.

Geen DB-migratie. Geen edge-function-wijziging. Geen contract-test-toevoeging — Snijplanning-RPCs leven al SQL-only.

## Overwogen alternatieven

- **`modules/planning/{snijplanning,confectie}/` als geneste Module** — afgewezen. Doorbreekt de DB-aligned-naming-conventie van ADR-0009/0011. Vereist Confectie-Module te verhuizen (extra churn). Alle bestaande Modules zijn solo-folders op één niveau; planning-Module-uitleg in `architectuur.md` was nooit uitgevoerd.

- **Smal scope (alleen hooks + cache.ts, queries blijven)** — afgewezen. Lib/queries blijven dan shallow utility-paden in `lib/utils/`. Snelste pad naar bug-fix, maar laat de Module half-baked en lost de andere drie utility-shallowness-problemen (compute-reststukken, snijplan-mapping, snij-volgorde) niet op.

- **Volledig scope (incl. components + pages)** — uitgesteld. `RolUitvoerModal` is 672 regels en mengt UI + geometry + RPC-orchestratie + sticker-print. Component-decompositie verdient een eigen ronde (candidate #4 uit de architectuur-skill-rapportage). Medium scope levert de structuurwinst zonder die complicaties.

- **Event-bus + lazy subscribers** — afgewezen. Frontend-event-bus voegt runtime-indirectie toe zonder iets te winnen wat de Module-helper-import niet ook doet. Producer-knows-consumer is geen leak in deze codebase: het is de domein-realiteit ("snijplan-mutatie raakt de confectie-lijst"). Subscriber-lifetime-management is een nieuwe complexiteit-bron die we niet willen.

- **Centrale `lib/cache-invalidation.ts`-registry** — afgewezen. Eén bestand groeit met élke Module; wordt churn-hotspot. Doorbreekt locality: query-keys leven niet meer bij de Module die ze bezit.

- **Hierarchical query keys (`['planning', 'snijplanning', ...]`)** — afgewezen. Te grof: één `invalidateQueries({queryKey:['planning']})` raakt onnodig veel. Krijgt geen handle op kruising met cross-Modules (Magazijn, Productie).

- **Snijplanning-Module nu met `RolUitvoerModal`-decompositie** — uitgesteld. Bundelt twee onafhankelijke deepenings in één PR; verdubbelt blast-radius. Separate vervolg-ADR (architectuur-skill-rapportage candidate #4) — zelfde discipline als ADR-0009/0011 die met meerdere vervolgrondes werken.

## Open kandidaten op de backlog

- **`RolUitvoerModal`-decompositie** — 672 regels, mengt UI + geometry-compute + sticker-print-popup + RPC-orchestratie + error-extractie. Splitsen in dunne UI-laag + Module-functie `executeRolAfsluiten()` die transactioneel orchestreert. Kandidaat voor eigen ADR.
- **Snijplan-status state-machine** — magic strings (`'Gesneden'`, `'In confectie'`, etc.) leven in SQL-views, RPCs, frontend-filters (`KLAAR_STATUSSEN`-constant) en TS-types zonder centrale invariant-bewaking. Kandidaat voor eigen ADR (architectuur-skill-rapportage candidate #3).
- **Productie-Module** — `['productie', 'dashboard']` is een gedeeld concept (snijplanning + confectie schrijven, productie-page leest). Mogelijk verdient het eigen `modules/productie/`-Module met `cache.ts`. Niet urgent: de huidige toestand werkt zolang de twee producer-Modules consequent `invalidateQueries(['productie', 'dashboard'])` aanroepen.
