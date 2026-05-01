# EDI-klantconfiguratie UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maak EDI-handelspartnerconfiguratie zichtbaar en bewerkbaar in de klanten-module: per debiteur welke EDI-processen actief zijn (order ontvangen, orderbev versturen, factuur versturen, verzending versturen), plus een overzicht-filter en een EDI-tag op de klantkaart, in dezelfde stijl als Transus Online.

**Architecture:**

Twee architectuur-keuzes uit `/improve-codebase-architecture` (2026-04-30) sturen dit plan:

1. **Verticale module-folder.** Alle EDI-frontend-code verhuist naar `frontend/src/modules/edi/` (sub-folders `components/`, `pages/`, `hooks/`, `queries/`, `lib/`, plus `registry.ts` en `index.ts`). De huidige spreiding over `lib/edi/`, `pages/edi/`, `components/edi/` en `lib/supabase/queries/edi.ts` wordt opgeruimd in **Task 0** zodat alle nieuwe code (EdiTag, KlantEdiTab) meteen op de juiste plek landt — zonder eerst nieuwe componenten in `components/klanten/` te zetten en die later weer te moeten verplaatsen.

2. **Berichttype-registry.** Eén centraal `BERICHTTYPE_REGISTRY` (in `modules/edi/registry.ts`) is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`, `verzendbericht`): code, richting, UI-label, UI-subtitle, `configToggleKey` (welk veld op `edi_handelspartner_config`), `relatedEntity`, `transusProcess`. `KlantEdiTab` itereert over `getBerichttypenVoorRichting('in')` + `getBerichttypenVoorRichting('uit')` i.p.v. een hard-coded `PROCESSEN`-array; `bericht-detail` en `berichten-overzicht` halen labels uit de registry. Backend (poll/send edge functions) blijft V1 op zijn huidige ad-hoc switch — registry-spiegel naar `supabase/functions/_shared/edi/registry.ts` is een follow-up als de uitgaande pipeline wordt uniformiseerd.

Backend bestaat al — de tabel `edi_handelspartner_config` (mig 156) en de queries `fetchHandelspartnerConfig` / `upsertHandelspartnerConfig` zijn er. We voegen alleen frontend-UI + module-skeleton + registry toe. Voor de overzicht-filter halen we de set actieve EDI-debiteur-nrs met één lichte query op (≤ 50 partners) en gebruiken die zowel voor `.in('debiteur_nr', …)` als voor de tag-rendering — geen view-wijziging nodig. We bouwen een `Map<debiteur_nr, test_modus>` zodat de kaart ook test-modus kan tonen ("EDI · TEST" wanneer relevant).

**Toekomstige cleanup (V2):**
- Voeg `edi_actief` + `edi_test_modus` toe aan de view `klant_omzet_ytd` zodat de extra roundtrip per pagina-laad weg kan.
- Spiegel `BERICHTTYPE_REGISTRY` naar `supabase/functions/_shared/edi/registry.ts` en laat `transus-poll`/`transus-send` ook over de registry itereren — daarmee verdwijnt de laatste ad-hoc dispatch-switch.
- Elimineer de duplicatie tussen `frontend/src/modules/edi/lib/karpi-fixed-width.ts` en `supabase/functions/_shared/transus-formats/karpi-fixed-width.ts` (eigen plan).

**Tech Stack:** React 18 + TypeScript, TanStack Query, TailwindCSS, shadcn/ui patterns, Vitest + @testing-library/react, Supabase JS client.

---

## File Structure

**Nieuwe bestanden (in de nieuwe vertical-module folder):**
- `frontend/src/modules/edi/registry.ts` — `BERICHTTYPE_REGISTRY` + types + helpers
- `frontend/src/modules/edi/index.ts` — public barrel-export (alleen wat externe modules nodig hebben)
- `frontend/src/modules/edi/components/edi-tag.tsx` — kleine herbruikbare badge "EDI" voor klantkaart en detail-header
- `frontend/src/modules/edi/components/klant-edi-tab.tsx` — EDI-tab op klant-detail (toggles + notities, mutation via upsert)
- `frontend/src/modules/edi/components/klant-edi-tab.test.tsx` — render + interactie-tests voor de tab

**Verplaatste bestanden (Task 0 — git mv):**
- `frontend/src/lib/edi/*` → `frontend/src/modules/edi/lib/*` (`bevestig-helper.ts`, `download-orderbev-xml.ts`, `upload-helper.ts`, `karpi-fixed-width.ts` + `.test.ts`, `transus-xml.ts` + `.test.ts`, `demo-helper.ts`)
- `frontend/src/pages/edi/*` → `frontend/src/modules/edi/pages/*` (`berichten-overzicht.tsx`, `bericht-detail.tsx`)
- `frontend/src/components/edi/*` → `frontend/src/modules/edi/components/*` (`upload-bericht-dialog.tsx`, `demo-bericht-dialog.tsx`)
- `frontend/src/lib/supabase/queries/edi.ts` → `frontend/src/modules/edi/queries/edi.ts`

**Bestaande bestanden om te wijzigen:**
- `frontend/src/lib/supabase/queries/klanten.ts` — `KlantRow` uitbreiden met `edi_actief: boolean` + `edi_test_modus: boolean`; `fetchKlanten` accepteert nieuw `edi_filter?: 'edi' | 'niet_edi'` en doet een aparte lichte fetch op `edi_handelspartner_config`
- `frontend/src/hooks/use-klanten.ts` — `useKlanten` accepteert `edi_filter`
- `frontend/src/pages/klanten/klanten-overview.tsx` — extra `<select>` filter "Alle / EDI / Niet-EDI"
- `frontend/src/components/klanten/klant-card.tsx` — toon `<EdiTag />` naast tier-badge als `klant.edi_actief`
- `frontend/src/pages/klanten/klant-detail.tsx` — voeg `'edi'` toe aan `Tab`-union + `TABS`-array, render `<KlantEdiTab debiteurNr={…} />`; toon `<EdiTag />` in header naast `StatusBadge`'s; haal `transus_actief` mee in `useKlantDetail`
- `frontend/src/router.tsx` (en/of waar de routes wonen) — alle `import` paths van EDI-pages bijwerken
- Alle import-statements in de codebase die naar oude EDI-paden wijzen — bulk-rewrite in Task 0
- `docs/changelog.md` — entry voor 2026-04-30 met de nieuwe UI + module-reorganisatie
- `docs/architectuur.md` — sectie "EDI-laag" verwijst naar `frontend/src/modules/edi/` als één feature-module + naar `registry.ts` als bron-van-waarheid voor berichttypen
- `docs/database-schema.md` — verwijzing naar UI-locatie bij `edi_handelspartner_config`

---

## Task 0: Vestig vertical EDI-module + berichttype-registry

**Doel:** Voorkom dat nieuwe componenten (Task 3, 7) eerst in `components/klanten/` landen en later weer verhuisd moeten worden. Tegelijk een centrale registry zodat de proces-lijst in `KlantEdiTab` en de labels in `bericht-detail` één bron-van-waarheid hebben.

**Files:**
- Create: `frontend/src/modules/edi/registry.ts`
- Create: `frontend/src/modules/edi/index.ts`
- Move (git mv): files uit `frontend/src/lib/edi/`, `frontend/src/pages/edi/`, `frontend/src/components/edi/`, `frontend/src/lib/supabase/queries/edi.ts` → naar `frontend/src/modules/edi/...`
- Modify: alle import-statements naar de oude paden

- [ ] **Step 1: Maak de folder-skeleton aan**

```bash
mkdir -p frontend/src/modules/edi/components
mkdir -p frontend/src/modules/edi/pages
mkdir -p frontend/src/modules/edi/queries
mkdir -p frontend/src/modules/edi/lib
mkdir -p frontend/src/modules/edi/hooks
```

(Hooks-folder is leeg in V1 — gereserveerd voor wanneer `useEdiBerichten` etc. uit `bericht-detail.tsx`/`berichten-overzicht.tsx` worden geëxtraheerd. Niet in dit plan.)

- [ ] **Step 2: Schrijf `registry.ts`**

```ts
// frontend/src/modules/edi/registry.ts
//
// Bron-van-waarheid voor de vier EDI-berichttypen. Frontend itereert hieroverheen
// (KlantEdiTab proces-lijst, bericht-detail labels, berichten-overzicht filter-opties).
//
// **V2:** spiegelen naar supabase/functions/_shared/edi/registry.ts zodat poll/send
// edge functions ook over de registry itereren i.p.v. ad-hoc switch op berichttype.

export type Berichttype = 'order' | 'orderbev' | 'factuur' | 'verzendbericht'
export type Richting = 'in' | 'uit'
export type ConfigToggleKey = 'order_in' | 'orderbev_uit' | 'factuur_uit' | 'verzend_uit'
export type RelatedEntity = 'order' | 'factuur' | 'zending'

export interface BerichttypeDef {
  code: Berichttype
  richting: Richting
  uiLabel: string
  uiSubtitle: string
  configToggleKey: ConfigToggleKey
  relatedEntity: RelatedEntity
  transusProcess: string
}

export const BERICHTTYPE_REGISTRY: Record<Berichttype, BerichttypeDef> = {
  order: {
    code: 'order',
    richting: 'in',
    uiLabel: 'Order ontvangen',
    uiSubtitle: 'Inkomende EDI-orders worden verwerkt',
    configToggleKey: 'order_in',
    relatedEntity: 'order',
    transusProcess: 'ORDERS',
  },
  orderbev: {
    code: 'orderbev',
    richting: 'uit',
    uiLabel: 'Orderbevestiging versturen',
    uiSubtitle: 'Outbound orderbev na orderbevestiging in RugFlow',
    configToggleKey: 'orderbev_uit',
    relatedEntity: 'order',
    transusProcess: 'ORDRSP',
  },
  factuur: {
    code: 'factuur',
    richting: 'uit',
    uiLabel: 'Factuur versturen',
    uiSubtitle: 'INVOIC-bericht na factuur-aanmaak',
    configToggleKey: 'factuur_uit',
    relatedEntity: 'factuur',
    transusProcess: 'INVOIC',
  },
  verzendbericht: {
    code: 'verzendbericht',
    richting: 'uit',
    uiLabel: 'Verzending versturen',
    uiSubtitle: 'DESADV bij verzendmelding',
    configToggleKey: 'verzend_uit',
    relatedEntity: 'zending',
    transusProcess: 'DESADV',
  },
}

export function getBerichttypenVoorRichting(richting: Richting): BerichttypeDef[] {
  return Object.values(BERICHTTYPE_REGISTRY).filter((t) => t.richting === richting)
}

export function getBerichttypeDef(code: Berichttype): BerichttypeDef {
  return BERICHTTYPE_REGISTRY[code]
}
```

- [ ] **Step 3: Verplaats bestaande EDI-bestanden met `git mv`**

Per file `git mv`-en (behoudt history). Vanuit repo-root:

```bash
# lib/edi/* → modules/edi/lib/*
git mv frontend/src/lib/edi/bevestig-helper.ts        frontend/src/modules/edi/lib/bevestig-helper.ts
git mv frontend/src/lib/edi/download-orderbev-xml.ts  frontend/src/modules/edi/lib/download-orderbev-xml.ts
git mv frontend/src/lib/edi/upload-helper.ts          frontend/src/modules/edi/lib/upload-helper.ts
git mv frontend/src/lib/edi/karpi-fixed-width.ts      frontend/src/modules/edi/lib/karpi-fixed-width.ts
git mv frontend/src/lib/edi/karpi-fixed-width.test.ts frontend/src/modules/edi/lib/karpi-fixed-width.test.ts
git mv frontend/src/lib/edi/transus-xml.ts            frontend/src/modules/edi/lib/transus-xml.ts
git mv frontend/src/lib/edi/transus-xml.test.ts       frontend/src/modules/edi/lib/transus-xml.test.ts
# (alleen als bestand bestaat)
[ -f frontend/src/lib/edi/demo-helper.ts ] && git mv frontend/src/lib/edi/demo-helper.ts frontend/src/modules/edi/lib/demo-helper.ts

# pages/edi/* → modules/edi/pages/*
git mv frontend/src/pages/edi/berichten-overzicht.tsx frontend/src/modules/edi/pages/berichten-overzicht.tsx
git mv frontend/src/pages/edi/bericht-detail.tsx      frontend/src/modules/edi/pages/bericht-detail.tsx

# components/edi/* → modules/edi/components/*
git mv frontend/src/components/edi/upload-bericht-dialog.tsx frontend/src/modules/edi/components/upload-bericht-dialog.tsx
[ -f frontend/src/components/edi/demo-bericht-dialog.tsx ] && git mv frontend/src/components/edi/demo-bericht-dialog.tsx frontend/src/modules/edi/components/demo-bericht-dialog.tsx

# queries
git mv frontend/src/lib/supabase/queries/edi.ts frontend/src/modules/edi/queries/edi.ts

# verwijder lege oude folders
rmdir frontend/src/lib/edi 2>/dev/null
rmdir frontend/src/pages/edi 2>/dev/null
rmdir frontend/src/components/edi 2>/dev/null
```

- [ ] **Step 4: Bulk-rewrite imports**

Zoek alle imports die naar oude paden wijzen en herschrijf ze. Vanuit `frontend/src/`:

| Oud | Nieuw |
|---|---|
| `@/lib/edi/bevestig-helper` | `@/modules/edi/lib/bevestig-helper` |
| `@/lib/edi/download-orderbev-xml` | `@/modules/edi/lib/download-orderbev-xml` |
| `@/lib/edi/upload-helper` | `@/modules/edi/lib/upload-helper` |
| `@/lib/edi/karpi-fixed-width` | `@/modules/edi/lib/karpi-fixed-width` |
| `@/lib/edi/transus-xml` | `@/modules/edi/lib/transus-xml` |
| `@/lib/edi/demo-helper` | `@/modules/edi/lib/demo-helper` |
| `@/pages/edi/berichten-overzicht` | `@/modules/edi/pages/berichten-overzicht` |
| `@/pages/edi/bericht-detail` | `@/modules/edi/pages/bericht-detail` |
| `@/components/edi/upload-bericht-dialog` | `@/modules/edi/components/upload-bericht-dialog` |
| `@/components/edi/demo-bericht-dialog` | `@/modules/edi/components/demo-bericht-dialog` |
| `@/lib/supabase/queries/edi` | `@/modules/edi/queries/edi` |

Gebruik bv. een Grep + Edit-loop, of vanuit de repo-root één pass per pad. Belangrijke caller-files om expliciet te checken: `frontend/src/router.tsx`, `frontend/src/components/layout/sidebar.tsx`, `frontend/src/pages/orders/order-form.tsx` (gebruikt `bevestig-helper`), `frontend/src/pages/orders/order-detail.tsx`. Ook relatieve imports binnen de zojuist verplaatste bestanden — die wijzen nog naar de oude relatieve paden voor *niet-EDI* dependencies (bv. `../../../lib/supabase/client` wordt vanuit nieuwe locatie `../../../../lib/supabase/client`); fix per bestand of vervang door `@/`-aliases.

- [ ] **Step 5: Schrijf `index.ts` (public barrel)**

```ts
// frontend/src/modules/edi/index.ts
//
// Public surface van de EDI-module. Externe imports (klanten-module, orders-module,
// router, sidebar) gaan bij voorkeur via deze barrel. Interne imports binnen de
// module mogen direct verwijzen naar sub-folders.

export { EdiTag } from './components/edi-tag'
export { KlantEdiTab } from './components/klant-edi-tab'
export { default as BerichtenOverzichtPage } from './pages/berichten-overzicht'
export { default as BerichtDetailPage } from './pages/bericht-detail'
export { UploadBerichtDialog } from './components/upload-bericht-dialog'
export {
  BERICHTTYPE_REGISTRY,
  getBerichttypenVoorRichting,
  getBerichttypeDef,
  type Berichttype,
  type BerichttypeDef,
  type ConfigToggleKey,
  type Richting,
} from './registry'
export {
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  type EdiHandelspartnerConfig,
} from './queries/edi'
```

(Welke exports daadwerkelijk in de barrel komen hangt af van wat de pages/components extern exporteren — pas aan op basis van type-checker-feedback. `EdiTag` en `KlantEdiTab` worden in Task 3 / Task 7 toegevoegd; tot dan kun je die regels gecommentarieerd laten.)

- [ ] **Step 6: Type-check + dev-server smoke**

```bash
cd frontend && npm run type-check
```

Verwacht: 0 errors. Als er imports zijn vergeten, lees per error welke caller niet bijgewerkt is en fix.

```bash
cd frontend && npm run dev
```

Open `/edi/berichten` en `/edi/berichten/<id>` (of klik vanuit sidebar) — verwacht: pagina's renderen identiek aan vóór de move (geen runtime-fouten in console). Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/edi/
git add frontend/src/  # voor alle gewijzigde imports
git commit -m "refactor(edi): vertical module-folder + berichttype-registry

Verplaatst alle EDI-frontend-code naar frontend/src/modules/edi/ en introduceert
een central BERICHTTYPE_REGISTRY als bron-van-waarheid voor de vier types.
Backend (poll/send edge functions) blijft V1 op huidige switch — registry-spiegel
volgt in een follow-up plan."
```

---

## Task 1: KlantRow + fetchKlanten uitbreiden met EDI-flag en filter

**Files:**
- Modify: `frontend/src/lib/supabase/queries/klanten.ts:4-18,90-123`

- [ ] **Step 1: Lees de bestaande queries en interface**

Lees `frontend/src/lib/supabase/queries/klanten.ts` in zijn geheel om het bestaande `KlantRow`-shape, de `fetchKlanten`-functie en het patroon (sanitizeSearch, range, count) op te slaan. Kennen vóór wijzigen.

- [ ] **Step 2: Breid `KlantRow` uit met `edi_actief` + `edi_test_modus`**

Voeg in `KlantRow` interface (rond regel 4) twee velden toe direct na `plaats`:

```ts
edi_actief: boolean
edi_test_modus: boolean
```

- [ ] **Step 3: Pas `fetchKlanten` aan: extra parameter + EDI-map query**

Wijzig de signatuur van `fetchKlanten` zodat hij `edi_filter?: 'edi' | 'niet_edi'` accepteert. Bovenaan de functie (vóór de hoofdquery) één keer de map met actieve EDI-debiteurs ophalen — we hebben `transus_actief` (filter) én `test_modus` (voor de kaart-badge) nodig:

```ts
// Lichte query: alle actieve EDI-debiteurs (in productie ~39 rijen). Klein dataset,
// extra roundtrip is sub-50ms. V2: hijs naar de view klant_omzet_ytd.
const { data: ediRows, error: ediErr } = await supabase
  .from('edi_handelspartner_config')
  .select('debiteur_nr, test_modus')
  .eq('transus_actief', true)
if (ediErr) throw ediErr
const ediMap = new Map<number, boolean>(
  (ediRows ?? []).map((r) => [r.debiteur_nr as number, r.test_modus as boolean]),
)
```

Pas de hoofdquery-builder aan: na de bestaande filters (`status`, `tier`, `vertegenw_code`, `search`) deze `edi_filter`-tak toevoegen vóór `await query`:

```ts
if (edi_filter === 'edi') {
  if (ediMap.size === 0) {
    return { klanten: [], totalCount: 0 }
  }
  query = query.in('debiteur_nr', Array.from(ediMap.keys()))
} else if (edi_filter === 'niet_edi' && ediMap.size > 0) {
  // PostgREST not.in syntax: ?col=not.in.(1,2,3)
  query = query.not('debiteur_nr', 'in', `(${Array.from(ediMap.keys()).join(',')})`)
}
```

En in de `return` rij-mapping toevoegen. Volg het bestaande `Record<string, unknown>`-patroon uit `fetchKlantArtikelnummers` (regel 193) zodat de cast expliciet en TS-strict-veilig is:

```ts
const klanten = (data ?? []).map((row: Record<string, unknown>) => {
  const debNr = row.debiteur_nr as number
  return {
    ...(row as Omit<KlantRow, 'edi_actief' | 'edi_test_modus'>),
    edi_actief: ediMap.has(debNr),
    edi_test_modus: ediMap.get(debNr) ?? false,
  }
})

return { klanten, totalCount: count ?? 0 }
```

(Vervang dus de bestaande `return { klanten: (data ?? []) as KlantRow[], totalCount: count ?? 0 }`.)

- [ ] **Step 4: Type-check**

Run vanuit `frontend/`:

```bash
npm run type-check
```

(Of, als dat script niet bestaat: `npx tsc --noEmit`.) Verwacht: 0 errors voor het gewijzigde bestand. Lees nieuwe foutmeldingen — alle huidige callers van `fetchKlanten` zonder `edi_filter` werken nog (param is optional). Als TS klaagt over `row.debiteur_nr`, controleer dat de `Record<string, unknown>`-cast precies zo is overgenomen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/supabase/queries/klanten.ts
git commit -m "feat(edi): klanten-query laadt edi_actief + edi_test_modus + edi_filter param"
```

---

## Task 2: useKlanten hook accepteert edi_filter

**Files:**
- Modify: `frontend/src/hooks/use-klanten.ts:12-24`

- [ ] **Step 1: Voeg `edi_filter` toe aan `useKlanten`-params**

Wijzig de signatuur:

```ts
export function useKlanten(params: {
  search?: string
  status?: string
  tier?: string
  vertegenw_code?: string
  edi_filter?: 'edi' | 'niet_edi'
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: ['klanten', params],
    queryFn: () => fetchKlanten(params),
  })
}
```

(De `queryKey: ['klanten', params]` zorgt automatisch voor cache-invalidatie bij wijzigend filter — geen extra werk nodig.)

- [ ] **Step 2: Type-check + commit**

```bash
cd frontend && npm run type-check && cd ..
git add frontend/src/hooks/use-klanten.ts
git commit -m "feat(edi): useKlanten accepteert edi_filter parameter"
```

---

## Task 3: EdiTag-component (badge "EDI" voor card en detail-header)

**Files:**
- Create: `frontend/src/modules/edi/components/edi-tag.tsx`

- [ ] **Step 1: Schrijf de component**

```tsx
interface EdiTagProps {
  testModus?: boolean
}

export function EdiTag({ testModus = false }: EdiTagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
        testModus
          ? 'bg-amber-100 text-amber-700'
          : 'bg-blue-100 text-blue-700'
      }`}
      title={testModus ? 'EDI in testmodus (Transus IsTestMessage=Y)' : 'EDI actief via Transus'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      EDI{testModus ? ' · TEST' : ''}
    </span>
  )
}
```

Geen complexere logica. De `testModus`-prop is optioneel zodat de tag op de klantkaart (waar test_modus niet bekend is) gewoon de standaard-blauwe variant toont; klant-detail kan wel de TEST-variant tonen omdat daar de volledige config beschikbaar is.

- [ ] **Step 2: Werk module-barrel bij**

Open `frontend/src/modules/edi/index.ts` en zorg dat de regel `export { EdiTag } from './components/edi-tag'` actief is (uit Task 0-Step 5 — moest eerder gecommentarieerd zijn).

- [ ] **Step 3: Visuele check — start dev server en bezoek /klanten**

Run vanuit `frontend/`:

```bash
npm run dev
```

Open `http://localhost:5173/klanten`. Verwacht: nog niets veranderd in de UI (component bestaat alleen). Geen runtime-fouten in de console. Stop met Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/edi/components/edi-tag.tsx frontend/src/modules/edi/index.ts
git commit -m "feat(edi): EdiTag-badge component voor klant-overzicht en detail"
```

---

## Task 4: KlantCard toont EdiTag

**Files:**
- Modify: `frontend/src/components/klanten/klant-card.tsx:46-53`

- [ ] **Step 1: Voeg de tag toe naast de tier-badge**

Importeer bovenin (via de module-barrel — niet via direct sub-pad, want klanten-module is een externe consumer):

```tsx
import { EdiTag } from '@/modules/edi'
```

Vervang de bestaande `<div className="flex items-center gap-2 mb-1">…</div>` door:

```tsx
<div className="flex items-center gap-2 mb-1">
  <h3 className="font-medium text-sm truncate">{klant.naam}</h3>
  <StatusBadge status={klant.tier} type="tier" />
  {klant.edi_actief && <EdiTag testModus={klant.edi_test_modus} />}
</div>
```

- [ ] **Step 2: Visuele check**

Run vanuit `frontend/`:

```bash
npm run dev
```

Open `/klanten`, scroll op zoek naar BDSK Handels (debiteur 600556) of een andere klant die je voorheen op `transus_actief=true` hebt gezet. Verwacht: blauwe "EDI"-badge naast de tier-badge op die kaart, andere kaarten ongewijzigd. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/klanten/klant-card.tsx
git commit -m "feat(edi): toon EdiTag op klantkaart voor EDI-actieve debiteuren"
```

---

## Task 5: Filter "Alle / EDI / Niet-EDI" op klanten-overzicht

**Files:**
- Modify: `frontend/src/pages/klanten/klanten-overview.tsx:9-65`

- [ ] **Step 1: Lokale state + filter-select**

Voeg na regel 12 (de bestaande `vertegFilter` state) toe:

```tsx
const [ediFilter, setEdiFilter] = useState<'' | 'edi' | 'niet_edi'>('')
```

Pas de `useKlanten`-call aan:

```tsx
const { data, isLoading } = useKlanten({
  search,
  status: statusFilter,
  vertegenw_code: vertegFilter || undefined,
  edi_filter: ediFilter || undefined,
  pageSize,
})
```

Voeg in de filter-rij (na de vertegenwoordigers-`<select>`) deze nieuwe select toe:

```tsx
<select
  value={ediFilter}
  onChange={(e) => handleFilterChange(setEdiFilter as (v: string) => void, e.target.value)}
  className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
>
  <option value="">Alle EDI-statussen</option>
  <option value="edi">EDI-klanten</option>
  <option value="niet_edi">Niet-EDI</option>
</select>
```

- [ ] **Step 2: Visuele check + smoke-test van PostgREST `not.in` syntax**

```bash
cd frontend && npm run dev
```

Open `/klanten`. Test alle drie de filter-statussen, met expliciete verificatie dat `not.in` correct werkt:

1. **"Alle EDI-statussen"** → totaal aantal klanten zichtbaar (header zegt bv. "1565 klanten")
2. **"EDI-klanten"** → alleen klanten met `transus_actief=true`. Tel het aantal kaarten ≈ aantal actieve EDI-debiteurs in de database. Iedere zichtbare kaart heeft een blauwe EDI-tag. **Open de browser-devtools Network-tab** en kijk naar de Supabase REST-call: de URL moet `debiteur_nr=in.(...)` bevatten.
3. **"Niet-EDI"** → de overige. **Verifieer in Network-tab** dat de URL `debiteur_nr=not.in.(...)` bevat (let op het `not.` prefix). Geen enkele zichtbare kaart heeft een EDI-tag.

Sluit-test: schakel filter heen en weer EDI ↔ Niet-EDI; aantal moet samen optellen tot het totaal van "Alle EDI-statussen". Als dat niet klopt, hebben we een lekkende-EDI-rij in de niet-EDI-set en moet het queryformaat (parens + komma) onderzocht worden.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/klanten/klanten-overview.tsx
git commit -m "feat(edi): EDI-filter op klanten-overzicht (alle/edi/niet-edi)"
```

---

## Task 6: KlantDetail interface uitbreiden + EdiTag in detail-header

**Files:**
- Modify: `frontend/src/lib/supabase/queries/klanten.ts:20-58,126-157`
- Modify: `frontend/src/pages/klanten/klant-detail.tsx:188-200`

- [ ] **Step 1: Voeg `edi_actief` + `edi_test_modus` toe aan `KlantDetail`**

Direct na de regel `btw_percentage: number` (rond regel 57), vóór de afsluitende `}` op regel 58, twee velden toevoegen:

```ts
edi_actief: boolean
edi_test_modus: boolean
```

- [ ] **Step 2: Pas `fetchKlantDetail` aan om de config mee op te halen**

De bestaande `Promise.all` heeft 2 elementen (`klantRes`, `omzetRes`). Vervang de hele `Promise.all` + return-block door deze versie — het complete blok om vergissingen te voorkomen:

```ts
const [klantRes, omzetRes, ediRes] = await Promise.all([
  supabase
    .from('debiteuren')
    .select('*, vertegenwoordigers(naam)')
    .eq('debiteur_nr', debiteurNr)
    .single(),
  supabase
    .from('orders')
    .select('totaal_bedrag')
    .eq('debiteur_nr', debiteurNr)
    .gte('orderdatum', ytdFrom)
    .neq('status', 'Geannuleerd'),
  supabase
    .from('edi_handelspartner_config')
    .select('transus_actief, test_modus')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle(),
])

if (klantRes.error) throw klantRes.error
if (ediRes.error) throw ediRes.error
// (omzetRes-fout wordt hieronder via .data ?? [] gepareerd zoals al bestond)

const row = klantRes.data as Record<string, unknown>
const verteg = row.vertegenwoordigers as { naam: string } | null
const omzetYtd = (omzetRes.data ?? []).reduce(
  (sum, o) => sum + (Number(o.totaal_bedrag) || 0),
  0,
)

return {
  ...row,
  vertegenwoordiger_naam: verteg?.naam ?? null,
  omzet_ytd: omzetYtd,
  edi_actief: ediRes.data?.transus_actief ?? false,
  edi_test_modus: ediRes.data?.test_modus ?? false,
} as KlantDetail
```

(`maybeSingle` levert `null` als de rij niet bestaat → defaults via nullish-coalescing; RLS/netwerk-fouten gaan via `ediRes.error`.)

- [ ] **Step 3: Toon EdiTag in detail-header**

In `klant-detail.tsx`: importeer bovenin (via module-barrel):

```tsx
import { EdiTag } from '@/modules/edi'
```

Pas de header-row aan (rond regel 190) zodat de EDI-tag tussen tier-badge en vertegenwoordiger-tekst komt:

```tsx
<div className="flex items-center gap-3">
  <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
  <StatusBadge status={klant.status} type="order" />
  <StatusBadge status={klant.tier} type="tier" />
  {klant.edi_actief && <EdiTag testModus={klant.edi_test_modus} />}
  {klant.vertegenwoordiger_naam && (
    <span className="text-sm text-slate-500">
      Verteg: <span className="font-medium text-slate-700">{klant.vertegenwoordiger_naam}</span>
    </span>
  )}
</div>
```

- [ ] **Step 4: Visuele check**

```bash
cd frontend && npm run dev
```

Open `/klanten/600556` (BDSK Handels — als die `transus_actief=true` heeft) of een andere EDI-klant. Verwacht: blauwe "EDI"-badge in de header, zichtbaar naast de tier-badge. Bij een test-modus-klant: amber "EDI · TEST"-badge.

Bezoek ook een niet-EDI-klant: geen badge.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/supabase/queries/klanten.ts frontend/src/pages/klanten/klant-detail.tsx
git commit -m "feat(edi): toon EDI/test-modus-tag in klant-detail-header"
```

---

## Task 7: KlantEdiTab — bewerk-formulier voor edi_handelspartner_config (registry-driven)

**Files:**
- Create: `frontend/src/modules/edi/components/klant-edi-tab.tsx`

**Belangrijk:** geen hard-coded `PROCESSEN`-array. De proces-lijst komt uit `BERICHTTYPE_REGISTRY` zodat een nieuw type (bv. ORDCHG) automatisch verschijnt zodra het in de registry staat.

- [ ] **Step 1: Schrijf de component**

Doel: laat alle vier de processen uit de registry zien (Order ontvangen, Orderbevestiging versturen, Factuur versturen, Verzending versturen) gegroepeerd op richting, plus de hoofdschakelaar `transus_actief`, plus `test_modus` en `notities`. Bij wijzigen direct upserten.

```tsx
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  type EdiHandelspartnerConfig,
} from '@/modules/edi/queries/edi'
import {
  BERICHTTYPE_REGISTRY,
  getBerichttypenVoorRichting,
  type BerichttypeDef,
  type ConfigToggleKey,
} from '@/modules/edi/registry'

interface KlantEdiTabProps {
  debiteurNr: number
}

const EMPTY_CONFIG: EdiHandelspartnerConfig = {
  debiteur_nr: 0,
  transus_actief: false,
  order_in: false,
  orderbev_uit: false,
  factuur_uit: false,
  verzend_uit: false,
  test_modus: false,
  notities: null,
  created_at: '',
  updated_at: '',
}

// Volgorde voor de UI: eerst inkomend, dan uitgaand. Binnen elke richting volgt
// de volgorde uit de registry (insertion-order van het Record).
const INKOMEND = getBerichttypenVoorRichting('in')
const UITGAAND = getBerichttypenVoorRichting('uit')

export function KlantEdiTab({ debiteurNr }: KlantEdiTabProps) {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: ['edi-handelspartner-config', debiteurNr],
    queryFn: () => fetchHandelspartnerConfig(debiteurNr),
    enabled: debiteurNr > 0,
  })

  const current = useMemo<EdiHandelspartnerConfig>(
    () => config ?? { ...EMPTY_CONFIG, debiteur_nr: debiteurNr },
    [config, debiteurNr],
  )

  const mutation = useMutation({
    mutationFn: (next: EdiHandelspartnerConfig) =>
      upsertHandelspartnerConfig({
        debiteur_nr: next.debiteur_nr,
        transus_actief: next.transus_actief,
        order_in: next.order_in,
        orderbev_uit: next.orderbev_uit,
        factuur_uit: next.factuur_uit,
        verzend_uit: next.verzend_uit,
        test_modus: next.test_modus,
        notities: next.notities,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['edi-handelspartner-config', debiteurNr] })
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      queryClient.invalidateQueries({ queryKey: ['klanten'] })
    },
  })

  const [notitiesDraft, setNotitiesDraft] = useState<string | null>(null)
  const notitiesValue = notitiesDraft ?? current.notities ?? ''

  function update<K extends keyof EdiHandelspartnerConfig>(key: K, value: EdiHandelspartnerConfig[K]) {
    mutation.mutate({ ...current, [key]: value })
  }

  function commitNotities() {
    if (notitiesDraft === null) return
    const trimmed = notitiesDraft.trim()
    const next = trimmed === '' ? null : trimmed
    if (next === current.notities) {
      setNotitiesDraft(null)
      return
    }
    update('notities', next)
    setNotitiesDraft(null)
  }

  if (debiteurNr <= 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klant geselecteerd</div>
  }

  if (isLoading) {
    return <div className="p-5 text-sm text-slate-400">EDI-configuratie laden…</div>
  }

  const processenDisabled = !current.transus_actief

  return (
    <div className="p-5 space-y-6 text-sm">
      {/* Hoofdschakelaar */}
      <div className="flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="font-medium text-slate-900">EDI via Transus</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Hoofdschakelaar — als uit, wordt deze klant door de EDI-laag genegeerd (handmatige flow).
          </div>
        </div>
        <Toggle
          checked={current.transus_actief}
          onChange={(v) => update('transus_actief', v)}
          disabled={mutation.isPending}
        />
      </div>

      {/* Test-modus */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-slate-900">Test-modus</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Markeer alle uitgaande berichten als <code className="text-[11px]">IsTestMessage=Y</code>.
            Voor cutover-test-handelspartner of staging.
          </div>
        </div>
        <Toggle
          checked={current.test_modus}
          onChange={(v) => update('test_modus', v)}
          disabled={mutation.isPending}
        />
      </div>

      {/* Inkomende processen */}
      <ProcessenSection
        titel="Inkomend"
        items={INKOMEND}
        config={current}
        disabled={processenDisabled}
        onToggle={(toggleKey, value) => update(toggleKey, value)}
        mutationPending={mutation.isPending}
      />

      {/* Uitgaande processen */}
      <ProcessenSection
        titel="Uitgaand"
        items={UITGAAND}
        config={current}
        disabled={processenDisabled}
        onToggle={(toggleKey, value) => update(toggleKey, value)}
        mutationPending={mutation.isPending}
      />

      {processenDisabled && (
        <div className="text-xs text-slate-400 italic">
          Activeer eerst de hoofdschakelaar om processen te kunnen aanzetten.
        </div>
      )}

      {/* Notities */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-2">
          Notities
        </label>
        <textarea
          value={notitiesValue}
          onChange={(e) => setNotitiesDraft(e.target.value)}
          onBlur={commitNotities}
          disabled={mutation.isPending}
          placeholder="Partner-specifieke aantekeningen — bv. 'Karpi-artnr in BP-veld', schema-versie, contactpersoon Transus"
          className="w-full min-h-[80px] px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 disabled:opacity-50"
        />
      </div>

      {mutation.isError && (
        <div className="text-xs text-red-600">
          Opslaan mislukt: {String((mutation.error as Error).message)}
        </div>
      )}
    </div>
  )
}

interface ProcessenSectionProps {
  titel: string
  items: BerichttypeDef[]
  config: EdiHandelspartnerConfig
  disabled: boolean
  onToggle: (toggleKey: ConfigToggleKey, value: boolean) => void
  mutationPending: boolean
}

function ProcessenSection({ titel, items, config, disabled, onToggle, mutationPending }: ProcessenSectionProps) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        {titel}
      </div>
      <div className={`rounded-[var(--radius-sm)] border border-slate-200 divide-y divide-slate-100 ${disabled ? 'opacity-50' : ''}`}>
        {items.map((def) => (
          <div key={def.code} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium text-slate-800">{def.uiLabel}</div>
              <div className="text-xs text-slate-500 mt-0.5">{def.uiSubtitle}</div>
            </div>
            <Toggle
              checked={Boolean(config[def.configToggleKey])}
              onChange={(v) => onToggle(def.configToggleKey, v)}
              disabled={mutationPending || disabled}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
        checked ? 'bg-terracotta-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
```

- [ ] **Step 2: Werk module-barrel bij**

Open `frontend/src/modules/edi/index.ts` en activeer `export { KlantEdiTab } from './components/klant-edi-tab'`.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npm run type-check && cd ..
```

Verwacht: 0 errors. Als de import van `@/modules/edi/registry` faalt, controleer of Task 0 succesvol is afgerond en `tsconfig.json` paths kloppen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/edi/components/klant-edi-tab.tsx frontend/src/modules/edi/index.ts
git commit -m "feat(edi): KlantEdiTab — registry-driven processen + transus_actief + test_modus + notities"
```

---

## Task 8: Test-coverage voor KlantEdiTab (test-after, presentatie-only)

**Pragmatische keuze:** dit is een presentatie-component zonder business-logica — alle logica leeft al in de bestaande backend-queries en in de registry. Daarom test-after in plaats van strikte TDD. Tests dekken render-toestand, disable-gedrag, mutate-call en default-fallback. Belangrijk: tests valideren ook dat de UI **alle registry-entries** rendert — als iemand een type aan de registry toevoegt zonder de tab uit te breiden, slaan de tests aan.

**Files:**
- Create: `frontend/src/modules/edi/components/klant-edi-tab.test.tsx`

- [ ] **Step 1: Schrijf de tests**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KlantEdiTab } from './klant-edi-tab'
import { BERICHTTYPE_REGISTRY } from '../registry'

vi.mock('@/modules/edi/queries/edi', () => ({
  fetchHandelspartnerConfig: vi.fn(),
  upsertHandelspartnerConfig: vi.fn(),
}))

import {
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
} from '@/modules/edi/queries/edi'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const BASE_CONFIG = {
  debiteur_nr: 600556,
  transus_actief: true,
  order_in: true,
  orderbev_uit: true,
  factuur_uit: false,
  verzend_uit: false,
  test_modus: false,
  notities: null,
  created_at: '2026-04-30T10:00:00Z',
  updated_at: '2026-04-30T10:00:00Z',
}

const TOTAL_TYPES = Object.keys(BERICHTTYPE_REGISTRY).length
// hoofdschakelaar + test_modus + alle berichttype-toggles
const TOTAL_TOGGLES = 2 + TOTAL_TYPES

beforeEach(() => {
  vi.clearAllMocks()
})

describe('KlantEdiTab', () => {
  it('toont alle berichttypen uit de registry met juiste toestand', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(BASE_CONFIG)

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    // Alle uiLabels uit de registry moeten in het document staan
    for (const def of Object.values(BERICHTTYPE_REGISTRY)) {
      expect(await screen.findByText(def.uiLabel)).toBeInTheDocument()
    }

    const toggles = screen.getAllByRole('switch')
    expect(toggles).toHaveLength(TOTAL_TOGGLES)
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true')   // transus_actief
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false')  // test_modus
  })

  it('schakelt processen uit als hoofdschakelaar uit staat', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue({
      ...BASE_CONFIG,
      transus_actief: false,
    })

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.order.uiLabel)
    const toggles = screen.getAllByRole('switch')
    // Alle proces-toggles (vanaf index 2) moeten disabled zijn
    for (let i = 2; i < toggles.length; i++) {
      expect(toggles[i]).toBeDisabled()
    }
  })

  it('roept upsert aan bij toggle-klik op een proces (factuur_uit)', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(BASE_CONFIG)
    vi.mocked(upsertHandelspartnerConfig).mockResolvedValue({
      ...BASE_CONFIG,
      factuur_uit: true,
    })

    renderWithClient(<KlantEdiTab debiteurNr={600556} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.factuur.uiLabel)
    // Vind de toggle naast het factuur-label via de DOM-structuur
    const factuurRow = screen.getByText(BERICHTTYPE_REGISTRY.factuur.uiLabel).closest('div')!.parentElement!
    const factuurToggle = factuurRow.querySelector('button[role="switch"]') as HTMLButtonElement
    fireEvent.click(factuurToggle)

    await waitFor(() => {
      expect(upsertHandelspartnerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          debiteur_nr: 600556,
          factuur_uit: true,
        }),
      )
    })
  })

  it('valt terug op default-config als geen rij bestaat', async () => {
    vi.mocked(fetchHandelspartnerConfig).mockResolvedValue(null)

    renderWithClient(<KlantEdiTab debiteurNr={999999} />)

    await screen.findByText(BERICHTTYPE_REGISTRY.order.uiLabel)
    const toggles = screen.getAllByRole('switch')
    // Alle toggles uit
    toggles.forEach((t) => expect(t).toHaveAttribute('aria-checked', 'false'))
    // Proces-toggles disabled (hoofdschakelaar uit)
    for (let i = 2; i < toggles.length; i++) {
      expect(toggles[i]).toBeDisabled()
    }
  })
})
```

- [ ] **Step 2: Run de tests**

```bash
cd frontend && npx vitest run src/modules/edi/components/klant-edi-tab.test.tsx
```

Verwacht: alle 4 tests slagen direct, want de component bestaat na Task 7. Als één faalt, lees output, fix component of test, herhaal tot groen.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/edi/components/klant-edi-tab.test.tsx
git commit -m "test(edi): KlantEdiTab — registry-driven render, toggle-disable, mutate, default-fallback"
```

---

## Task 9: KlantEdiTab inhaken in klant-detail-pagina

**Files:**
- Modify: `frontend/src/pages/klanten/klant-detail.tsx:12-29,471-490`

- [ ] **Step 1: Importeer en voeg tab toe**

Importeer bovenin (na de andere tab-imports) — via de module-barrel:

```tsx
import { KlantEdiTab } from '@/modules/edi'
```

Pas de `Tab`-union aan:

```tsx
type Tab = 'info' | 'adressen' | 'orders' | 'facturering' | 'eigennamen' | 'artikelnummers' | 'prijslijst' | 'edi'
```

Pas de `TABS`-array aan — voeg conditioneel of altijd toe? **Altijd**: net als andere tabs blijft `EDI` zichtbaar; voor niet-EDI-klanten zien gebruikers daar gewoon de uit-stand. Dat past bij het Transus-model waar je per partner kan opzetten.

```tsx
const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'adressen', label: 'Afleveradressen' },
  { key: 'orders', label: 'Orders' },
  { key: 'facturering', label: 'Facturering' },
  { key: 'eigennamen', label: 'Klanteigen namen' },
  { key: 'artikelnummers', label: 'Artikelnummers' },
  { key: 'prijslijst', label: 'Prijslijst' },
  { key: 'edi', label: 'EDI' },
]
```

In de tab-content-render-block (na `{activeTab === 'prijslijst' && …}`):

```tsx
{activeTab === 'edi' && <KlantEdiTab debiteurNr={debiteurNr} />}
```

- [ ] **Step 2: Visuele check + e2e flow**

```bash
cd frontend && npm run dev
```

Test-flow:
1. Open `/klanten/600556` (BDSK Handels)
2. Klik tab "EDI" — verwacht: 4 processen met huidige toestand, gegroepeerd in **Inkomend** (1) + **Uitgaand** (3)
3. Zet `Test-modus` aan → header-badge wijzigt direct naar "EDI · TEST" (amber, dankzij `queryClient.invalidateQueries`)
4. Zet hoofdschakelaar uit → processen vergrijzen + krijgen disabled, EDI-badge verdwijnt
5. Open `/klanten` overzicht → BDSK heeft nu geen blauwe EDI-tag meer (filter "EDI" sluit hem ook uit)
6. Zet hoofdschakelaar weer aan, Test-modus weer uit → terug naar oude toestand

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/klanten/klant-detail.tsx
git commit -m "feat(edi): EDI-tab op klant-detail (registry-driven processen + test-modus + notities)"
```

---

## Task 10: Documentatie bijwerken

**Files:**
- Modify: `docs/changelog.md` (eerste regels, datum 2026-04-30)
- Modify: `docs/architectuur.md` (sectie EDI-laag — voeg verwijzing naar `frontend/src/modules/edi/` + `registry.ts` toe)
- Modify: `docs/database-schema.md` (sectie `edi_handelspartner_config`, voeg verwijzing naar UI toe)

- [ ] **Step 1: Lees de huidige docs**

Lees `docs/changelog.md`, `docs/architectuur.md` en `docs/database-schema.md` om de huidige stijl en EDI-secties te zien.

- [ ] **Step 2: Voeg changelog-entries toe**

Bovenaan de relevante datum-sectie (of nieuwe sectie 2026-04-30) twee regels — module-reorganisatie en UI-feature:

```md
- **EDI vertical-module + berichttype-registry** — `frontend/src/lib/edi/`, `frontend/src/pages/edi/`, `frontend/src/components/edi/` en `frontend/src/lib/supabase/queries/edi.ts` zijn samengevoegd onder [`frontend/src/modules/edi/`](frontend/src/modules/edi/). Nieuwe [`registry.ts`](frontend/src/modules/edi/registry.ts) is bron-van-waarheid voor de vier berichttypen (UI-labels, configToggleKey, richting, transusProcess). Backend-spiegel volgt in eigen plan.
- **EDI-klantconfiguratie UI** — klant-detail krijgt EDI-tab met de processen uit de registry + test-modus + notities, klanten-overzicht krijgt EDI-filter en EDI-tag op klantkaart. Schrijft naar bestaande `edi_handelspartner_config` (mig 156). UI: [klant-edi-tab.tsx](frontend/src/modules/edi/components/klant-edi-tab.tsx), [edi-tag.tsx](frontend/src/modules/edi/components/edi-tag.tsx).
```

- [ ] **Step 3: Architectuur-doc update**

In `docs/architectuur.md` — sectie "EDI-laag" (of vergelijkbaar): voeg een paragraaf toe over de vertical-module-keuze:

```md
**Frontend-organisatie (vanaf 2026-04-30):** alle EDI-frontend-code leeft onder
[`frontend/src/modules/edi/`](../frontend/src/modules/edi/) als één feature-module
(`pages/`, `components/`, `hooks/`, `queries/`, `lib/`). Externe consumers (klanten-,
orders-modules, router, sidebar) importeren via de barrel `@/modules/edi`.

**Berichttype-registry:** [`registry.ts`](../frontend/src/modules/edi/registry.ts)
is bron-van-waarheid voor de vier types (`order`, `orderbev`, `factuur`,
`verzendbericht`). UI-componenten itereren over `getBerichttypenVoorRichting(...)`
i.p.v. hard-coded lijsten. Backend (poll/send edge functions) gebruikt de registry
nog niet — V2-werk: spiegel naar `supabase/functions/_shared/edi/registry.ts`.
```

- [ ] **Step 4: Database-schema verwijzing**

In de bestaande `edi_handelspartner_config`-tabel-sectie van `docs/database-schema.md`, voeg na de kolombeschrijving een `**UI:**`-regel toe:

```md
**UI:** Bewerkbaar via klant-detail → tab "EDI" ([klant-edi-tab.tsx](../frontend/src/modules/edi/components/klant-edi-tab.tsx)). Klanten-overzicht heeft EDI-filter en toont een EDI-tag op kaarten van debiteuren met `transus_actief=true`. Proces-lijst wordt gegenereerd uit [`modules/edi/registry.ts`](../frontend/src/modules/edi/registry.ts).
```

- [ ] **Step 5: Commit**

```bash
git add docs/changelog.md docs/architectuur.md docs/database-schema.md
git commit -m "docs: EDI vertical-module + klantconfiguratie UI in changelog/architectuur/schema"
```

---

## Task 11: Eindverificatie + lint + type-check + tests

**Files:** geen wijzigingen.

- [ ] **Step 1: Volledige type-check**

```bash
cd frontend && npm run type-check
```

Verwacht: 0 errors.

- [ ] **Step 2: Lint**

```bash
cd frontend && npm run lint
```

Verwacht: 0 errors. Eventuele warnings: lees ze af, fix als ze betrekking hebben op nieuwe code.

- [ ] **Step 3: Test-suite**

```bash
cd frontend && npm run test:run
```

Verwacht: alle tests groen (inclusief de 4 nieuwe in `klant-edi-tab.test.tsx`, plus de verplaatste tests in `modules/edi/lib/`).

- [ ] **Step 4: Eindcheck in browser**

```bash
cd frontend && npm run dev
```

Doorloop de hele flow nogmaals:
- `/edi/berichten` en `/edi/berichten/:id` werken nog (na de move uit Task 0)
- `/klanten` → 3 filter-statussen werken
- EDI-klant → kaart heeft tag → detail toont tag → tab "EDI" laat alle registry-processen zien (gegroepeerd Inkomend/Uitgaand) → toggles + notities slaan op
- Niet-EDI-klant → geen tag, tab "EDI" toont uit-stand met disabled processen

Stop dev server.

- [ ] **Step 5: Geen extra commit nodig — alleen melden in PR-omschrijving als alles groen**

---

## Acceptatiecriteria (uit de oorspronkelijke vraag + architectuur-review)

- [x] EDI-klanten kunnen geïdentificeerd worden in de klantenlijst (filter + tag op kaart)
- [x] Op klant-detail kan per debiteur worden ingesteld welke processen actief zijn (registry-driven, identiek aan Transus Online → Processen)
- [x] Test-modus aparte schakelaar
- [x] Notities-veld voor partner-specifieke aantekeningen
- [x] EDI-tag visueel zichtbaar bij EDI-klanten op kaart en in detail-header
- [x] Geen migratie nodig — backend bestond al sinds mig 156
- [x] **Vertical-module-folder:** alle EDI-frontend-code onder `frontend/src/modules/edi/` (geen spreiding meer over lib/pages/components-toplevels)
- [x] **Berichttype-registry:** één bron-van-waarheid voor de vier types — KlantEdiTab itereert over de registry, geen hard-coded `PROCESSEN`-array
