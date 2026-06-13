# Universele communicatie-knoppen (kanaal-dispatch EDI vs e-mail) — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De operator denkt in documenten ("bevestig order", "verstuur factuur", "meld verzending") — het systeem kiest zelf het kanaal: EDI-order → Transus-bericht, gewone order → e-mail. EDI-orders krijgen nóóit een e-mail. Alle uitgaande communicatie (e-mail én EDI) wordt op order-detail in één tijdlijn getoond.

**Architecture:** Vier verticale slices. (1) De "Bevestig order"-knop in de order-header wordt een kanaal-dispatcher op basis van `orders.bron_systeem` + `edi_handelspartner_config`; de bestaande EDI-bevestig-flow (`bevestigOrderViaEdi`) wordt herbruikbaar via een gedeelde hook. (2) `factuur-verzenden` onderdrukt de e-mail wanneer de EDI-INVOIC actief is. (3) De e-mailtijdlijn (mig 365, branch `feat/order-email-tijdlijn`) wordt uitgebreid tot "Communicatie"-tijdlijn die óók uitgaande `edi_berichten` toont — géén dubbel-loggen, twee bronnen, één gesorteerde lijst. (4) Verzendbevestiging (DESADV) via EDI: edge function `bouw-verzendbericht-edi` (spiegelt `bouw-factuur-edi`) + cron-sweep over verzonden EDI-orders; payload-format wordt gereverse-engineered uit een Transus-voorbeeld (externe afhankelijkheid, expliciet STOP-punt).

**Tech Stack:** React 18 + TypeScript + TanStack Query + vitest (frontend), Supabase Edge Functions (Deno) + PostgreSQL/pg_cron (backend), Transus SOAP M10100 via bestaande `transus-send`-cron.

---

## Vooraf: repo-conventies & omgeving (lees dit eerst)

- **Branch:** maak één feature-branch `feat/universele-communicatie-knoppen` vanaf `main`, bij voorkeur in een **eigen worktree** (memory: parallelle sessies wisselen de gedeelde tree van branch). Let op: `.env`-bestanden (`frontend/.env`, `supabase/functions/.env`) bestaan alleen in de hoofd-tree — kopieer ze naar de worktree als je live-DB-verificatiescripts wilt draaien.
- **Niet mergen naar `main`** — merge gebeurt alleen op expliciet commando van Miguel.
- **Frontend-tests:** `cd frontend && npm run test:run` (vitest). Specifiek bestand: `npm run test:run -- bevestiging-kanaal`.
- **Typecheck (verplicht vóór elke commit-reeks):** `cd frontend && npm run typecheck`.
- **Edge-function-tests (Deno):** `deno test --allow-read supabase/functions/_shared/transus-formats/`.
- **Edge-function-deploy:** `supabase functions deploy <naam> --project-ref wqzeevfobwauxkalagtn` (CLI is gelinkt). **Deploy alleen na akkoord van Miguel** — slice 2 en 4 raken productie-mailgedrag.
- **Migraties:** schrijf het bestand in `supabase/migrations/`; **NIET `supabase db push`** (gevaarlijk, memory). Toepassen gebeurt handmatig (Miguel of via Supabase SQL-editor). Markeer in je rapportage welke migraties nog toegepast moeten worden.
- **Migratienummer:** bepaal het eerstvolgende vrije nummer pas vlak vóór het aanmaken én check open branches op collisies (memory: 3 collisies op 10 juni):
  ```powershell
  Get-ChildItem supabase/migrations | Sort-Object Name | Select-Object -Last 3
  git branch -a --format='%(refname:short)' | ForEach-Object { git ls-tree -r --name-only $_ supabase/migrations 2>$null } | Sort-Object -Unique | Select-Object -Last 5
  ```
  In dit plan heten ze `3XX` / `3XY` — vervang door echte nummers. NB: branch `feat/order-email-tijdlijn` bevat al `365_verstuurde_emails_log.sql`.
- **Docs bijwerken is verplicht** (CLAUDE.md): `docs/changelog.md` per slice; `docs/database-schema.md` bij mig-wijzigingen; `docs/order-lifecycle.md` bij slice 1 (bevestiging-gates); CLAUDE.md-bedrijfsregels bij slice 1, 2 en 4.
- **Tekstvervangingen altijd via de Edit-tool**, nooit PowerShell `-replace` (UTF-8-mojibake, memory).

### Afhankelijkheden tussen slices

| Slice | Afhankelijkheid |
|---|---|
| 1 — Universele bevestig-knop | geen — direct uitvoerbaar |
| 2 — Factuur e-mail onderdrukken | geen — maar **conflict-risico**: branch `feat/order-email-tijdlijn` (commit `5d8d1eb`) wijzigt `factuur-verzenden/index.ts` óók (logging-rijen). Bij merge: beide wijzigingen behouden. |
| 3 — Communicatie-tijdlijn | **GEBLOKKEERD** tot `feat/order-email-tijdlijn` in `main` zit (tabel `verstuurde_emails` + component `order-emails.tsx`). Check: `git log main --oneline --grep="e-mailtijdlijn"` en bestaan van `frontend/src/components/orders/order-emails.tsx` op je branch. Zo niet: sla slice 3 over, rapporteer, ga door met slice 4. |
| 4 — DESADV verzendbevestiging | Taak 12 (format) heeft een **extern voorbeeldbestand** nodig dat alleen Miguel kan downloaden uit Transus Online — STOP-punt. Taken 11 en 13–15 (infra) kunnen er omheen gebouwd worden. |

### Domeincontext in 30 seconden

- Inkomende EDI-orders hebben `orders.bron_systeem='edi'` en een rij in `edi_berichten` (`richting='in'`, `order_id` gevuld, `payload_parsed` = geparseerde partner-order).
- Uitgaand EDI = rij in `edi_berichten` (`richting='uit'`, `status='Wachtrij'`, `payload_raw` = kant-en-klaar bericht). Cron `transus-send` (elke minuut, mig 305) verstuurt `payload_raw` dom via SOAP M10100 en zet `status='Verstuurd'` + `sent_at` + `transactie_id`, of `status='Fout'`.
- Per partner staan toggles in `edi_handelspartner_config`: `transus_actief`, `orderbev_uit`, `factuur_uit`, `verzend_uit`, `test_modus`.
- Twee bevestigings-gates op orders: `bevestigd_at` (e-mail-orderbevestiging, mig 304) en `edi_bevestigd_op` (EDI-leverweek, mig 158). Die blijven allebei bestaan; slice 1 verenigt alleen de UI erbovenop.

---

# SLICE 1 — Universele "Bevestig order"-knop

**Eindresultaat:** de groene "Bevestig order"-knop in de order-header werkt voor élk ordertype. Bij een EDI-order opent een EDI-bevestigdialog (leverweek kiezen → ORDRSP op de wachtrij, géén mail); bij een gewone order de bestaande e-maildialog. Partners met `orderbev_uit=false` (SB Möbel BOSS, Hammer) krijgen géén ORDRSP — de order wordt dan alleen administratief bevestigd. Het bestaande amber leverweek-paneel blijft als reminder bestaan en gebruikt dezelfde gedeelde logica.

### Task 1: Pure kanaal-helper `bevestiging-kanaal.ts`

**Files:**
- Create: `frontend/src/lib/orders/bevestiging-kanaal.ts`
- Test: `frontend/src/lib/orders/bevestiging-kanaal.test.ts`

- [ ] **Step 1: Schrijf de failing tests**

```typescript
// frontend/src/lib/orders/bevestiging-kanaal.test.ts
import { describe, expect, it } from 'vitest'
import { bepaalBevestigingKanaal, isOrderBevestigd } from './bevestiging-kanaal'

describe('bepaalBevestigingKanaal', () => {
  it('niet-EDI-order → email, ongeacht config', () => {
    expect(bepaalBevestigingKanaal(null, null)).toBe('email')
    expect(bepaalBevestigingKanaal(undefined, null)).toBe('email')
    expect(bepaalBevestigingKanaal('handmatig', null)).toBe('email')
    expect(
      bepaalBevestigingKanaal('shopify', { transus_actief: true, orderbev_uit: true }),
    ).toBe('email')
  })

  it('EDI-order met transus_actief én orderbev_uit → edi', () => {
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: true, orderbev_uit: true }),
    ).toBe('edi')
  })

  it('EDI-order zonder orderbev_uit of zonder actieve partner → edi_stil (nooit mail)', () => {
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: true, orderbev_uit: false }),
    ).toBe('edi_stil')
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: false, orderbev_uit: true }),
    ).toBe('edi_stil')
    expect(bepaalBevestigingKanaal('edi', null)).toBe('edi_stil')
  })
})

describe('isOrderBevestigd', () => {
  it('EDI-order kijkt uitsluitend naar edi_bevestigd_op', () => {
    expect(
      isOrderBevestigd({ bron_systeem: 'edi', edi_bevestigd_op: '2026-06-11T10:00:00Z', bevestigd_at: null }),
    ).toBe(true)
    expect(
      isOrderBevestigd({ bron_systeem: 'edi', edi_bevestigd_op: null, bevestigd_at: '2026-06-11T10:00:00Z' }),
    ).toBe(false)
  })

  it('niet-EDI-order kijkt uitsluitend naar bevestigd_at', () => {
    expect(
      isOrderBevestigd({ bron_systeem: null, bevestigd_at: '2026-06-11T10:00:00Z', edi_bevestigd_op: null }),
    ).toBe(true)
    expect(
      isOrderBevestigd({ bron_systeem: 'handmatig', bevestigd_at: null, edi_bevestigd_op: null }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run de test, verifieer dat hij faalt**

Run: `cd frontend && npm run test:run -- bevestiging-kanaal`
Expected: FAIL — `Cannot find module './bevestiging-kanaal'`

- [ ] **Step 3: Implementeer de helper**

```typescript
// frontend/src/lib/orders/bevestiging-kanaal.ts
// Kanaal-dispatch voor de universele "Bevestig order"-knop.
//
// De operator denkt in documenten ("bevestig order"), niet in kanalen. Deze
// pure helpers bepalen op basis van het order-label (bron_systeem) en de
// EDI-partnerconfig welk kanaal de orderbevestiging gebruikt:
//   'edi'      → ORDRSP op de uitgaande Transus-wachtrij (geen e-mail)
//   'edi_stil' → EDI-order, maar partner wil geen orderbev (orderbev_uit=false)
//                of partner is (nog) niet actief: bevestig alleen administratief,
//                verstuur niets — een EDI-order krijgt nooit een e-mail.
//   'email'    → klassieke PDF-orderbevestiging per e-mail (stuur-orderbevestiging).
//
// Mirrort qua opzet intake-predicaten.ts / edi-leverweek.ts (pure, testbaar).

export type BevestigingKanaal = 'edi' | 'edi_stil' | 'email'

export interface KanaalConfig {
  transus_actief: boolean
  orderbev_uit: boolean
}

export function bepaalBevestigingKanaal(
  bronSysteem: string | null | undefined,
  config: KanaalConfig | null,
): BevestigingKanaal {
  if (bronSysteem !== 'edi') return 'email'
  if (config?.transus_actief && config.orderbev_uit) return 'edi'
  return 'edi_stil'
}

export interface BevestigStatusVelden {
  bron_systeem?: string | null
  bevestigd_at?: string | null
  edi_bevestigd_op?: string | null
}

/**
 * Eén "is deze order bevestigd"-definitie voor header en overzicht.
 * EDI-orders zijn bevestigd via de EDI-gate (mig 158), gewone orders via de
 * e-mail-gate (mig 304). De gates blijven gescheiden kolommen.
 */
export function isOrderBevestigd(o: BevestigStatusVelden): boolean {
  if (o.bron_systeem === 'edi') return !!o.edi_bevestigd_op
  return !!o.bevestigd_at
}
```

- [ ] **Step 4: Run de test, verifieer PASS**

Run: `cd frontend && npm run test:run -- bevestiging-kanaal`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/orders/bevestiging-kanaal.ts frontend/src/lib/orders/bevestiging-kanaal.test.ts
git commit -m "feat(orders): pure kanaal-helper voor universele bevestig-knop (edi/edi_stil/email)"
```

### Task 2: `bevestigOrderZonderEdiBericht` in bevestig-helper

**Files:**
- Modify: `frontend/src/modules/edi/lib/bevestig-helper.ts` (append na regel 213)
- Modify: `frontend/src/modules/edi/index.ts` (regel 34, export uitbreiden)

- [ ] **Step 1: Voeg de stille bevestig-functie toe**

Append onderaan `bevestig-helper.ts`:

```typescript
/**
 * Bevestig een EDI-order administratief ZONDER orderbev te versturen — voor
 * partners met orderbev_uit=false (kanaal 'edi_stil'). Zet alleen de
 * edi_bevestigd_op-gate via de idempotente RPC; er gaat geen bericht en
 * géén e-mail uit (EDI-orders mailen we nooit).
 */
export async function bevestigOrderZonderEdiBericht(orderId: number): Promise<string> {
  const { data, error } = await supabase.rpc('markeer_order_edi_bevestigd', {
    p_order_id: orderId,
  })
  if (error) throw error
  return data as string
}
```

- [ ] **Step 2: Exporteer hem via de module-barrel**

In `frontend/src/modules/edi/index.ts` regel 34:

```typescript
export { bevestigOrderViaEdi, bevestigOrderZonderEdiBericht } from './lib/bevestig-helper'
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/edi/lib/bevestig-helper.ts frontend/src/modules/edi/index.ts
git commit -m "feat(edi): bevestigOrderZonderEdiBericht voor partners zonder orderbev_uit"
```

### Task 3: Gedeelde hook `useBevestigEdiOrder`

De bevestig-logica zit nu inline in `edi-leverweek-bevestigen.tsx` (`handleBevestig`, regels 52-85). Die verhuist naar een hook zodat het amber paneel én de nieuwe dialog (Task 4) hem delen — en de hook respecteert vanaf nu `orderbev_uit` (dat deed het paneel niet: het stuurde altijd een ORDRSP).

**Files:**
- Create: `frontend/src/modules/edi/lib/use-bevestig-edi-order.ts`
- Modify: `frontend/src/components/orders/edi-leverweek-bevestigen.tsx`
- Modify: `frontend/src/modules/edi/index.ts`

- [ ] **Step 1: Schrijf de hook**

```typescript
// frontend/src/modules/edi/lib/use-bevestig-edi-order.ts
// Gedeelde bevestig-flow voor EDI-orders: gebruikt door het amber
// leverweek-paneel op order-detail én de universele BevestigOrderEdiDialog.
//
// Bepaalt zelf het kanaal ('edi' = ORDRSP versturen, 'edi_stil' = alleen
// administratief bevestigen) op basis van edi_handelspartner_config — de
// orderbev_uit-toggle werd vóór dit plan nergens gecheckt, waardoor ook
// partners die geen orderbev willen (SB Möbel BOSS, Hammer) er één kregen.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import {
  bepaalBevestigingKanaal,
  type BevestigingKanaal,
} from '@/lib/orders/bevestiging-kanaal'
import { fetchInkomendBerichtVoorOrder, fetchHandelspartnerConfig } from '../queries/edi'
import { bevestigOrderViaEdi, bevestigOrderZonderEdiBericht } from './bevestig-helper'
import { KARPI_GLN_DEFAULT, type KarpiOrder } from './karpi-fixed-width'

export function useBevestigEdiOrder(orderId: number, debiteurNr: number) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: bericht, isLoading: berichtLoading } = useQuery({
    queryKey: ['edi-inkomend-voor-order', orderId],
    queryFn: () => fetchInkomendBerichtVoorOrder(orderId),
    staleTime: Infinity, // inkomend bericht is onveranderlijk na aanmaak
  })

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['edi-handelspartner-config', debiteurNr],
    queryFn: () => fetchHandelspartnerConfig(debiteurNr),
    staleTime: 60_000,
  })

  const kanaal: BevestigingKanaal = bepaalBevestigingKanaal(
    'edi',
    config ? { transus_actief: config.transus_actief, orderbev_uit: config.orderbev_uit } : null,
  )

  /**
   * Zet de gekozen afleverdatum vast en bevestig via het juiste kanaal.
   * @param gekozenDatum ISO-datum (YYYY-MM-DD) van de bevestigde leverweek.
   */
  async function bevestig(gekozenDatum: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      // 1. Bevestigde afleverdatum vastzetten (operator-keuze) — de orderbev
      //    leest deze datum (bevestig-helper Task 6-gedrag, mig 309).
      const { error: updErr } = await supabase
        .from('orders')
        .update({ afleverdatum: gekozenDatum })
        .eq('id', orderId)
      if (updErr) throw updErr

      // 2. Kanaal-dispatch.
      if (kanaal === 'edi') {
        if (!bericht?.payload_parsed) {
          throw new Error('Geen bron-EDI-bericht gevonden voor deze order')
        }
        await bevestigOrderViaEdi(
          orderId,
          bericht.id,
          bericht.payload_parsed as unknown as KarpiOrder,
          KARPI_GLN_DEFAULT,
          { isTest: bericht.is_test ?? false },
        )
      } else {
        // 'edi_stil': partner wil/kan geen orderbev — alleen de gate zetten.
        await bevestigOrderZonderEdiBericht(orderId)
      }

      // 3. Verfris order-detail + overzicht + tellingen.
      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['order', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
      qc.invalidateQueries({ queryKey: ['edi-inkomend-voor-order', orderId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setBusy(false)
    }
  }

  return {
    kanaal,
    bericht,
    isLoading: berichtLoading || configLoading,
    busy,
    error,
    bevestig,
  }
}
```

- [ ] **Step 2: Exporteer via de barrel**

In `frontend/src/modules/edi/index.ts`, voeg toe:

```typescript
export { useBevestigEdiOrder } from './lib/use-bevestig-edi-order'
```

- [ ] **Step 3: Refactor het amber paneel naar de hook**

Vervang in `frontend/src/components/orders/edi-leverweek-bevestigen.tsx` de inline query + `handleBevestig` (regels 41-85) door de hook. De component krijgt één extra prop. Volledige nieuwe inhoud van de gewijzigde delen:

```typescript
// imports: vervang supabase/bevestigOrderViaEdi/fetchInkomendBerichtVoorOrder/KARPI_GLN_DEFAULT door:
import { useBevestigEdiOrder } from '@/modules/edi'
import { useQueryClient } from '@tanstack/react-query' // mag weg als nergens anders gebruikt

interface Props {
  orderId: number
  debiteurNr: number
  /** EDI-gewenste leverdatum (klant) — orders.edi_gewenste_afleverdatum (ISO). */
  gewenstIso: string | null
  /** Huidige (haalbare) afleverdatum — orders.afleverdatum (ISO). */
  afleverdatumIso: string | null
  /** Order-status, als haalbaarheidssignaal (bv. 'Wacht op inkoop'). */
  orderStatus: string
}

export function EdiLeverweekBevestigen({ orderId, debiteurNr, gewenstIso, afleverdatumIso, orderStatus }: Props) {
  const [weekStr, setWeekStr] = useState(verzendWeekIsoString(afleverdatumIso || gewenstIso))
  const { kanaal, bericht, isLoading, busy, error, bevestig } = useBevestigEdiOrder(orderId, debiteurNr)

  const gekozenDatum = verzendWeekStringToDatum(weekStr)
  const vergelijking = vergelijkLeverweek(gewenstIso, gekozenDatum)

  async function handleBevestig() {
    if (!gekozenDatum) return
    try {
      await bevestig(gekozenDatum)
    } catch {
      // error-state wordt door de hook gezet
    }
  }
  // ... rest van de JSX ongewijzigd, met twee aanpassingen:
}
```

JSX-aanpassingen:
1. Knoptekst dynamisch maken (regel 144):
```tsx
{kanaal === 'edi' ? 'Bevestig leverweek + verstuur orderbev' : 'Bevestig leverweek (geen EDI-orderbev — uitgeschakeld voor deze partner)'}
```
2. De disabled-conditie van de knop (regel 139): `disabled={busy || isLoading || !gekozenDatum || (kanaal === 'edi' && !bericht)}` — bij `edi_stil` is geen bron-bericht nodig.
3. De rose fout-tekst "Geen bron-EDI-bericht gevonden" (regels 147-151) alleen tonen bij `kanaal === 'edi' && !isLoading && !bericht`.

- [ ] **Step 4: Geef de nieuwe prop door op order-detail**

In `frontend/src/pages/orders/order-detail.tsx` (regel ~120):

```tsx
<EdiLeverweekBevestigen
  orderId={order.id}
  debiteurNr={order.debiteur_nr}
  gewenstIso={order.edi_gewenste_afleverdatum ?? null}
  afleverdatumIso={order.afleverdatum}
  orderStatus={order.status}
/>
```

- [ ] **Step 5: Typecheck + bestaande tests**

Run: `cd frontend && npm run typecheck && npm run test:run`
Expected: 0 type-errors; geen nieuwe testfouten (NB: `magazijn-pickbaarheid.contract.test.ts` faalt 7/7 pre-existing op main — negeren, memory).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/edi/lib/use-bevestig-edi-order.ts frontend/src/modules/edi/index.ts frontend/src/components/orders/edi-leverweek-bevestigen.tsx frontend/src/pages/orders/order-detail.tsx
git commit -m "refactor(edi): gedeelde useBevestigEdiOrder-hook + orderbev_uit-gate in bevestig-flow"
```

### Task 4: `BevestigOrderEdiDialog`-component

**Files:**
- Create: `frontend/src/components/orders/bevestig-order-edi-dialog.tsx`

- [ ] **Step 1: Schrijf de dialog**

Zelfde modal-stijl als `BevestigOrderDialog`, inhoud = leverweek-flow van het amber paneel:

```tsx
// frontend/src/components/orders/bevestig-order-edi-dialog.tsx
import { useState } from 'react'
import { CalendarClock, Loader2, Check, AlertTriangle } from 'lucide-react'
import {
  verzendWeekKort,
  verzendWeekIsoString,
  verzendWeekStringToDatum,
} from '@/lib/orders/verzendweek'
import { vergelijkLeverweek } from '@/lib/orders/edi-leverweek'
import { useBevestigEdiOrder } from '@/modules/edi'

interface Props {
  orderId: number
  orderNr: string
  debiteurNr: number
  gewenstIso: string | null
  afleverdatumIso: string | null
  orderStatus: string
  onClose: () => void
}

/**
 * EDI-variant van de universele "Bevestig order"-knop. Geen e-mailveld:
 * een EDI-order wordt nooit per mail bevestigd. Bij kanaal 'edi' gaat een
 * ORDRSP op de Transus-wachtrij; bij 'edi_stil' (partner zonder orderbev_uit)
 * wordt alleen de edi_bevestigd_op-gate gezet.
 */
export function BevestigOrderEdiDialog({
  orderId, orderNr, debiteurNr, gewenstIso, afleverdatumIso, orderStatus, onClose,
}: Props) {
  const [weekStr, setWeekStr] = useState(verzendWeekIsoString(afleverdatumIso || gewenstIso))
  const [klaar, setKlaar] = useState(false)
  const { kanaal, bericht, isLoading, busy, error, bevestig } = useBevestigEdiOrder(orderId, debiteurNr)

  const gekozenDatum = verzendWeekStringToDatum(weekStr)
  const vergelijking = vergelijkLeverweek(gewenstIso, gekozenDatum)

  async function handleBevestig() {
    if (!gekozenDatum) return
    try {
      await bevestig(gekozenDatum)
      setKlaar(true)
    } catch {
      // error-state komt uit de hook
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-md w-full mx-4">
        {klaar ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4">
              <Check className="text-green-500" size={40} />
              <h3 className="text-lg font-semibold text-slate-900">Order bevestigd</h3>
              <p className="text-sm text-slate-600 text-center">
                {kanaal === 'edi' ? (
                  <>De orderbevestiging van <strong>{orderNr}</strong> staat op de EDI-wachtrij en wordt binnen een minuut via Transus verstuurd.</>
                ) : (
                  <><strong>{orderNr}</strong> is administratief bevestigd. Deze partner ontvangt geen EDI-orderbevestiging (uitgeschakeld in de EDI-config).</>
                )}
              </p>
            </div>
            <button onClick={onClose} className="w-full mt-4 px-4 py-2 bg-slate-100 text-slate-700 rounded-[var(--radius-sm)] hover:bg-slate-200 text-sm font-medium">
              Sluiten
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock size={18} className="text-terracotta-500" />
              <h3 className="text-lg font-semibold text-slate-900">Order bevestigen (EDI)</h3>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {kanaal === 'edi'
                ? <>De bevestiging van <strong>{orderNr}</strong> gaat via EDI (Transus) naar de partner — niet per e-mail.</>
                : <>Deze partner ontvangt geen EDI-orderbevestiging (uitgeschakeld). De order wordt alleen administratief bevestigd; er gaat géén bericht en géén e-mail uit.</>}
            </p>

            <div className="mb-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-slate-500">Klant wenst</div>
                <div className="font-medium text-slate-800">
                  {gewenstIso ? `${verzendWeekKort(gewenstIso)} · ${gewenstIso}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Haalbaar (voorraad/inkoop)</div>
                <div className="font-medium text-slate-800">
                  {afleverdatumIso ? `${verzendWeekKort(afleverdatumIso)} · ${afleverdatumIso}` : '—'}
                  <span className="ml-2 text-xs text-slate-500">status: {orderStatus}</span>
                </div>
              </div>
            </div>

            {vergelijking.relatie === 'later' && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={14} />
                Gekozen week valt {vergelijking.weken} {vergelijking.weken === 1 ? 'week' : 'weken'} later dan de klantwens.
              </div>
            )}
            {vergelijking.relatie === 'eerder' && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-100 px-3 py-2 text-sm text-slate-700">
                <AlertTriangle size={14} />
                Gekozen week valt {vergelijking.weken} {vergelijking.weken === 1 ? 'week' : 'weken'} vóór de klantwens — controleer of dit klopt.
              </div>
            )}

            <label className="block text-sm mb-4">
              <span className="mb-1 block text-slate-500">Bevestig leverweek</span>
              <input
                type="week"
                value={weekStr}
                onChange={(e) => setWeekStr(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {kanaal === 'edi' && !isLoading && !bericht && (
              <p className="mb-3 text-sm text-rose-600">
                Geen bron-EDI-bericht gevonden — bevestigen kan alleen via de EDI-module.
              </p>
            )}
            {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 disabled:opacity-50">
                Annuleren
              </button>
              <button
                onClick={handleBevestig}
                disabled={busy || isLoading || !gekozenDatum || (kanaal === 'edi' && !bericht)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-terracotta-500 text-white rounded-[var(--radius-sm)] hover:bg-terracotta-600 disabled:opacity-50 font-medium"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {kanaal === 'edi' ? 'Bevestig + verstuur via EDI' : 'Bevestig (zonder bericht)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/bevestig-order-edi-dialog.tsx
git commit -m "feat(orders): EDI-variant van de bevestig-order-dialog (leverweek, geen e-mail)"
```

### Task 5: Kanaal-dispatch in de order-header

**Files:**
- Modify: `frontend/src/components/orders/order-header.tsx`
- Verify/Modify: `frontend/src/lib/supabase/queries/orders.ts` (OrderDetail-interface)

- [ ] **Step 1: Verifieer dat `OrderDetail` de benodigde velden heeft**

Check in `frontend/src/lib/supabase/queries/orders.ts` dat het `OrderDetail`-interface (rond regel 86) deze velden bevat én dat de bijbehorende select ze ophaalt: `bron_systeem`, `edi_bevestigd_op`, `edi_gewenste_afleverdatum`, `debiteur_nr`. (order-detail.tsx gebruikt `order.edi_gewenste_afleverdatum` en `isLeverweekTeBevestigen(order)` al, dus waarschijnlijk aanwezig — zo niet: voeg toe aan interface én select-string.)

- [ ] **Step 2: Dispatch in de header**

In `order-header.tsx`:

```typescript
// imports erbij:
import { bepaalBevestigingKanaal, isOrderBevestigd } from '@/lib/orders/bevestiging-kanaal'
import { BevestigOrderEdiDialog } from './bevestig-order-edi-dialog'
import { useQuery } from '@tanstack/react-query'
import { fetchHandelspartnerConfig } from '@/modules/edi'
```

In de component-body (na regel 28):

```typescript
const isEdiOrder = order.bron_systeem === 'edi'
const { data: ediConfig } = useQuery({
  queryKey: ['edi-handelspartner-config', order.debiteur_nr],
  queryFn: () => fetchHandelspartnerConfig(order.debiteur_nr),
  enabled: isEdiOrder, // alleen relevant voor EDI-orders
  staleTime: 60_000,
})
const kanaal = bepaalBevestigingKanaal(
  order.bron_systeem,
  ediConfig ? { transus_actief: ediConfig.transus_actief, orderbev_uit: ediConfig.orderbev_uit } : null,
)
const bevestigd = isOrderBevestigd(order)
```

Vervang de bevestigd-conditie op regel 86: `!isConcept && order.bevestigd_at` → `!isConcept && bevestigd`. Pas de badge-title aan zodat hij voor EDI het juiste tijdstip toont:

```tsx
title={
  isEdiOrder
    ? `Bevestigd via EDI op ${formatDate(order.edi_bevestigd_op!)}`
    : `Bevestigd op ${formatDate(order.bevestigd_at!)}${order.bevestiging_email ? ` → ${order.bevestiging_email}` : ''}`
}
```

De "Opnieuw versturen"-knop (regels 95-103) alleen tonen bij `!isEdiOrder` (EDI-herversturing loopt via de EDI-bericht-detailpagina; de orderbev-seq-logica zit daar al).

Vervang de dialog-render (regels 207-215) door een kanaal-switch:

```tsx
{showBevestigDialog && (kanaal === 'email' ? (
  <BevestigOrderDialog
    orderId={order.id}
    orderNr={order.order_nr}
    defaultEmail={order.bevestiging_email ?? (order as any).klant_email ?? null}
    isHerversturing={!!order.bevestigd_at}
    onClose={() => setShowBevestigDialog(false)}
  />
) : (
  <BevestigOrderEdiDialog
    orderId={order.id}
    orderNr={order.order_nr}
    debiteurNr={order.debiteur_nr}
    gewenstIso={order.edi_gewenste_afleverdatum ?? null}
    afleverdatumIso={order.afleverdatum}
    orderStatus={order.status}
    onClose={() => setShowBevestigDialog(false)}
  />
))}
```

- [ ] **Step 3: Typecheck + tests**

Run: `cd frontend && npm run typecheck && npm run test:run`
Expected: 0 type-errors, geen nieuwe testfouten.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/orders/order-header.tsx frontend/src/lib/supabase/queries/orders.ts
git commit -m "feat(orders): universele bevestig-knop dispatcht naar EDI- of e-maildialog op bron_systeem"
```

### Task 6: Docs slice 1

- [ ] **Step 1: Changelog-entry** in `docs/changelog.md` (bovenaan, datumkop `## 2026-06-XX — Universele bevestig-knop: kanaal-dispatch EDI vs e-mail`): wat (dispatcher, edi_stil, orderbev_uit-gate gefixt, isOrderBevestigd) + waarom (operator denkt in documenten; EDI-partners kregen 0 orderbevs sinds cutover 3 juni; orderbev_uit werd genegeerd).
- [ ] **Step 2: `docs/order-lifecycle.md`**: beschrijf de twee bevestigings-gates (`bevestigd_at` vs `edi_bevestigd_op`) + kanaal-dispatch-tabel.
- [ ] **Step 3: CLAUDE.md**: voeg onder Bedrijfsregels een beknopte regel toe: *"Universele bevestig-knop (plan 2026-06-11): 'Bevestig order' dispatcht op `bron_systeem` — EDI-order → ORDRSP via `useBevestigEdiOrder` (gate `orderbev_uit`; `edi_stil` = alleen `edi_bevestigd_op` zetten), anders e-mail via `stuur-orderbevestiging`. EDI-orders krijgen nooit een e-mail-orderbevestiging. Eén bevestigd-predicaat: `isOrderBevestigd` in `frontend/src/lib/orders/bevestiging-kanaal.ts`."*
- [ ] **Step 4: Commit** `git commit -m "docs: universele bevestig-knop (slice 1)"`

---

# SLICE 2 — Factuur: e-mail onderdrukken bij actieve EDI-INVOIC

**Eindresultaat:** een debiteur met `transus_actief && factuur_uit` krijgt de factuur uitsluitend via EDI; de e-mail (incl. betaler-kopie) wordt overgeslagen. PDF blijft gewoon in storage.

### Task 7: Mail-gate in `factuur-verzenden`

**Files:**
- Modify: `supabase/functions/factuur-verzenden/index.ts` (regel ~340)

⚠️ **Conflict-let-op:** branch `feat/order-email-tijdlijn` (commit `5d8d1eb`) wijzigt ditzelfde bestand (+59 regels logging). Als die branch al gemerged is: de mail-gate hieronder moet óók om de nieuwe `verstuurde_emails`-logging heen (logging hoort alleen te gebeuren als er daadwerkelijk gemaild is — check dat de log-aanroep bínnen het `if`-blok valt).

- [ ] **Step 1: Pas de conditie aan**

Regel 340, was:

```typescript
      if (debiteur.email_factuur) {
```

wordt:

```typescript
      // EDI-partners krijgen de factuur uitsluitend via Transus (afspraak
      // 2026-06-11: EDI nooit óók per e-mail). De PDF blijft in storage en
      // de INVOIC is in stap 6 al op de wachtrij gezet.
      if (!ediFactuurActief && debiteur.email_factuur) {
```

- [ ] **Step 2: Controleer de `verstuurd_naar`-finalisatie (regel ~395)**

Die is al EDI-aware (`|| (ediBerichtId ? 'EDI Transus' : null)`) — maar het eerste deel `[debiteur.email_factuur, betalerEmail].filter(Boolean).join(', ')` zou bij een EDI-partner mét e-mailadres ten onrechte het e-mailadres loggen terwijl er niet gemaild is. Vervang door:

```typescript
          verstuurd_naar: ediBerichtId
            ? 'EDI Transus'
            : [debiteur.email_factuur, betalerEmail].filter(Boolean).join(', ') || null,
```

- [ ] **Step 3: Lokale Deno-check**

Run: `deno check supabase/functions/factuur-verzenden/index.ts`
Expected: geen errors (remote imports worden gecachet; netwerk nodig bij eerste run).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/factuur-verzenden/index.ts
git commit -m "feat(facturatie): geen factuur-e-mail meer bij actieve EDI-INVOIC (EDI nooit via mail)"
```

- [ ] **Step 5: Changelog + CLAUDE.md**

Changelog-entry (waarom: dubbel kanaal voorkomen; partner-afspraak EDI-only). CLAUDE.md bedrijfsregel-zin bij de bestaande facturatie-regels: *"factuur_uit && transus_actief → uitsluitend EDI-INVOIC, géén e-mail (mail-gate in factuur-verzenden stap 7)."* Commit.

- [ ] **Step 6: Deploy (NA AKKOORD MIGUEL)**

```bash
supabase functions deploy factuur-verzenden --project-ref wqzeevfobwauxkalagtn
```

Verificatie na deploy: eerstvolgende factuur voor een EDI-partner → check `facturen.verstuurd_naar='EDI Transus'`, een rij in `edi_berichten` (`berichttype='factuur'`, status loopt naar `Verstuurd`) en géén rij/mail via Graph. Diagnose-script-patroon: `scripts/_tmp_check_edi_uitgaand.mjs`.

---

# SLICE 3 — Communicatie-tijdlijn (e-mails + EDI-berichten) op order-detail

**GATE:** alleen uitvoeren als `verstuurde_emails` (mig 365) + `frontend/src/components/orders/order-emails.tsx` op je branch bestaan (= `feat/order-email-tijdlijn` gemerged). Zo niet: overslaan en rapporteren.

**Eindresultaat:** de sectie "E-mails" op order-detail heet "Communicatie" en toont naast e-mails ook uitgaande EDI-berichten van de order, met live status (Wachtrij / Verstuurd / Fout) en link naar het EDI-bericht. Géén dubbel-loggen: e-mails uit `verstuurde_emails`, EDI uit `edi_berichten` — één gesorteerde lijst.

### Task 8: Pure merge-helper `communicatie-tijdlijn.ts`

**Files:**
- Create: `frontend/src/lib/orders/communicatie-tijdlijn.ts`
- Test: `frontend/src/lib/orders/communicatie-tijdlijn.test.ts`

- [ ] **Step 1: Schrijf de failing tests**

```typescript
// frontend/src/lib/orders/communicatie-tijdlijn.test.ts
import { describe, expect, it } from 'vitest'
import { bouwCommunicatieTijdlijn, type EdiTijdlijnBron } from './communicatie-tijdlijn'
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

const email = (id: number, op: string): VerstuurdeEmail => ({
  id, order_id: 1, factuur_id: null, soort: 'orderbevestiging',
  onderwerp: `Mail ${id}`, verzonden_aan: 'klant@x.nl', verzonden_op: op,
  html: null, bijlagen: [],
})
const edi = (id: number, created: string, sent: string | null, status = 'Verstuurd'): EdiTijdlijnBron => ({
  id, berichttype: 'orderbev', status, is_test: false, sent_at: sent, created_at: created,
})

describe('bouwCommunicatieTijdlijn', () => {
  it('merget e-mails en EDI-berichten gesorteerd nieuwste-eerst', () => {
    const items = bouwCommunicatieTijdlijn(
      [email(1, '2026-06-10T10:00:00Z')],
      [edi(5, '2026-06-11T08:00:00Z', '2026-06-11T08:01:00Z')],
    )
    expect(items.map((i) => i.key)).toEqual(['edi-5', 'email-1'])
    expect(items[0].soort).toBe('edi')
    expect(items[1].soort).toBe('email')
  })

  it('EDI-item gebruikt sent_at als tijdstip, met created_at als fallback (Wachtrij/Fout)', () => {
    const [wachtrij] = bouwCommunicatieTijdlijn([], [edi(7, '2026-06-11T09:00:00Z', null, 'Wachtrij')])
    expect(wachtrij.tijdstip).toBe('2026-06-11T09:00:00Z')
    expect(wachtrij.ediStatus).toBe('Wachtrij')
  })

  it('berichttype-labels zijn Nederlands', () => {
    const [item] = bouwCommunicatieTijdlijn([], [edi(9, '2026-06-11T09:00:00Z', null, 'Wachtrij')])
    expect(item.label).toBe('Orderbevestiging')
  })
})
```

- [ ] **Step 2: Run, verifieer FAIL** — `npm run test:run -- communicatie-tijdlijn` → module not found.

- [ ] **Step 3: Implementeer**

```typescript
// frontend/src/lib/orders/communicatie-tijdlijn.ts
// Voegt de twee communicatie-bronnen van een order samen tot één tijdlijn:
//   - verstuurde_emails (mig 365) — e-mails, altijd 'verstuurd'
//   - edi_berichten richting='uit' — EDI, asynchroon (Wachtrij → Verstuurd/Fout)
// Bewust GEEN dubbel-loggen: elke bron blijft z'n eigen bron-van-waarheid;
// deze helper is puur presentatie-merge (testbaar zonder Supabase).
import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

export interface EdiTijdlijnBron {
  id: number
  berichttype: string
  status: string
  is_test: boolean
  sent_at: string | null
  created_at: string
}

export interface CommunicatieItem {
  key: string
  soort: 'email' | 'edi'
  label: string
  tijdstip: string
  /** Alleen voor EDI: Wachtrij | Bezig | Verstuurd | Fout. */
  ediStatus: string | null
  isTest: boolean
  email: VerstuurdeEmail | null
  ediBerichtId: number | null
}

const EDI_LABELS: Record<string, string> = {
  orderbev: 'Orderbevestiging',
  factuur: 'Factuur',
  verzendbericht: 'Verzendbevestiging',
}

const EMAIL_LABELS: Record<VerstuurdeEmail['soort'], string> = {
  factuur: 'Factuur',
  orderbevestiging: 'Orderbevestiging',
}

export function bouwCommunicatieTijdlijn(
  emails: VerstuurdeEmail[],
  ediBerichten: EdiTijdlijnBron[],
): CommunicatieItem[] {
  const emailItems: CommunicatieItem[] = emails.map((e) => ({
    key: `email-${e.id}`,
    soort: 'email',
    label: EMAIL_LABELS[e.soort] ?? e.soort,
    tijdstip: e.verzonden_op,
    ediStatus: null,
    isTest: false,
    email: e,
    ediBerichtId: null,
  }))
  const ediItems: CommunicatieItem[] = ediBerichten.map((b) => ({
    key: `edi-${b.id}`,
    soort: 'edi',
    label: EDI_LABELS[b.berichttype] ?? b.berichttype,
    tijdstip: b.sent_at ?? b.created_at,
    ediStatus: b.status,
    isTest: b.is_test,
    email: null,
    ediBerichtId: b.id,
  }))
  return [...emailItems, ...ediItems].sort((a, b) => b.tijdstip.localeCompare(a.tijdstip))
}
```

- [ ] **Step 4: Run, verifieer PASS** — `npm run test:run -- communicatie-tijdlijn`

- [ ] **Step 5: Commit** `git commit -m "feat(orders): pure communicatie-tijdlijn-merge (e-mails + EDI-berichten)"`

### Task 9: Query voor uitgaande EDI-berichten per order

**Files:**
- Modify: `frontend/src/modules/edi/queries/edi.ts` (append)
- Modify: `frontend/src/modules/edi/index.ts` (export)

- [ ] **Step 1: Voeg de query toe** (onderaan `edi.ts`):

```typescript
/**
 * Uitgaande EDI-berichten van een order, voor de Communicatie-tijdlijn op
 * order-detail. Bewust geen payload-velden (zwaar); de dialog linkt door
 * naar /edi/berichten/:id voor de volledige inhoud.
 */
export interface EdiUitgaandTijdlijnItem {
  id: number
  berichttype: string
  status: string
  is_test: boolean
  sent_at: string | null
  created_at: string
}

export async function fetchUitgaandeEdiBerichtenVoorOrder(
  orderId: number,
): Promise<EdiUitgaandTijdlijnItem[]> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select('id, berichttype, status, is_test, sent_at, created_at')
    .eq('order_id', orderId)
    .eq('richting', 'uit')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EdiUitgaandTijdlijnItem[]
}
```

Export in `index.ts`: `fetchUitgaandeEdiBerichtenVoorOrder, type EdiUitgaandTijdlijnItem` toevoegen aan het bestaande export-blok uit `'./queries/edi'`.

- [ ] **Step 2: Typecheck + commit** `git commit -m "feat(edi): query uitgaande berichten per order voor communicatie-tijdlijn"`

### Task 10: `OrderEmails` → `Communicatie`-sectie

**Files:**
- Modify: `frontend/src/components/orders/order-emails.tsx`

- [ ] **Step 1: Bouw de gecombineerde lijst in de component**

```tsx
// extra imports:
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import { fetchUitgaandeEdiBerichtenVoorOrder } from '@/modules/edi'
import { bouwCommunicatieTijdlijn } from '@/lib/orders/communicatie-tijdlijn'
```

In de component:

```tsx
export function OrderEmails({ orderId }: Props) {
  const { data: emails, isLoading } = useEmailsVoorOrder(orderId)
  const { data: ediBerichten, isLoading: ediLoading } = useQuery({
    queryKey: ['edi-uitgaand-voor-order', orderId],
    queryFn: () => fetchUitgaandeEdiBerichtenVoorOrder(orderId),
  })
  const [openEmail, setOpenEmail] = useState<VerstuurdeEmail | null>(null)

  if (isLoading || ediLoading) return null
  const items = bouwCommunicatieTijdlijn(emails ?? [], ediBerichten ?? [])
  if (items.length === 0) return null
  // kop: "Communicatie" i.p.v. "E-mails"
```

Render per item: e-mail-items exact zoals nu (knop → `setOpenEmail(item.email!)`); EDI-items als rij met `ArrowLeftRight`-icoontje, label, status-badge en link:

```tsx
{items.map((item) =>
  item.soort === 'email' ? (
    /* bestaande e-mail-rij, met item.email! */
  ) : (
    <li key={item.key}>
      <Link
        to={`/edi/berichten/${item.ediBerichtId}`}
        className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs text-slate-400 whitespace-nowrap w-28 shrink-0">
          {formatDateTime(item.tijdstip)}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
          <ArrowLeftRight size={11} /> EDI
        </span>
        <span className="text-sm text-terracotta-500 hover:underline truncate">
          {item.label}{item.isTest ? ' (test)' : ''}
        </span>
        <span className={`text-xs ml-auto ${item.ediStatus === 'Fout' ? 'text-rose-600 font-medium' : item.ediStatus === 'Verstuurd' ? 'text-green-600' : 'text-slate-400'}`}>
          {item.ediStatus}
        </span>
      </Link>
    </li>
  ),
)}
```

NB: check het werkelijke route-pad van EDI-bericht-detail in `frontend/src/App.tsx` (of router-bestand) — `/edi/berichten/:id` is de verwachting; pas aan indien anders.

- [ ] **Step 2: Typecheck + tests + commit**

```bash
cd frontend && npm run typecheck && npm run test:run
git add frontend/src/components/orders/order-emails.tsx
git commit -m "feat(orders): communicatie-tijdlijn toont ook uitgaande EDI-berichten met live status"
```

- [ ] **Step 3: Changelog-entry** (kop "Communicatie-tijdlijn: EDI-berichten naast e-mails op order-detail"; benoem de design-keuze géén dubbel-loggen). Commit.

---

# SLICE 4 — Verzendbevestiging (DESADV) via EDI

**Eindresultaat:** zodra een EDI-order op `Verzonden` staat en de partner `verzend_uit && transus_actief` heeft, bouwt edge function `bouw-verzendbericht-edi` het verzendbericht en zet het op de uitgaande wachtrij (`berichttype='verzendbericht'`); `transus-send` verstuurt het. Een cron-sweep maakt het self-healing. Verschijnt automatisch in de Communicatie-tijdlijn (slice 3) — geen extra UI nodig.

**Partners die hierop wachten:** Hornbach NL (361208) en BDSK (600556) — `verzend_uit` staat daar al aan.

### Task 11: Builder-interface + mapper (format-onafhankelijk deel)

**Files:**
- Create: `supabase/functions/_shared/transus-formats/karpi-verzendbericht.ts`
- Test: `supabase/functions/_shared/transus-formats/karpi-verzendbericht.test.ts`

- [ ] **Step 1: Definieer de bevroren input-interface + mapper-validatie (TDD)**

Test eerst:

```typescript
// supabase/functions/_shared/transus-formats/karpi-verzendbericht.test.ts
import { assertEquals, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { valideerVerzendberichtInput, type VerzendberichtInput } from './karpi-verzendbericht.ts';

const basis: VerzendberichtInput = {
  zendingNr: 'ZEND-2026-0042',
  verzenddatum: '2026-06-11',
  leverdatum: '2026-06-12',
  orderNumberBuyer: '8MRE0',
  orderNumberSupplier: 'ORD-2026-0334',
  senderGln: '8715954999998',
  recipientGln: '9007019010007',
  buyerGln: '9007019015989',
  deliveryPartyGln: '8712423012345',
  trackingNummer: null,
  isTestMessage: false,
  regels: [
    { regelnummer: 1, gtin: '8715954123456', artikelcode: 'KW123', omschrijving: 'Tapijt', aantal: 2 },
  ],
};

Deno.test('valideerVerzendberichtInput accepteert volledige input', () => {
  assertEquals(valideerVerzendberichtInput(basis), undefined);
});

Deno.test('valideerVerzendberichtInput gooit bij ontbrekende GLN of lege regels', () => {
  assertThrows(() => valideerVerzendberichtInput({ ...basis, recipientGln: '' }));
  assertThrows(() => valideerVerzendberichtInput({ ...basis, regels: [] }));
});
```

Implementatie:

```typescript
// supabase/functions/_shared/transus-formats/karpi-verzendbericht.ts
// Verzendbericht (DESADV) richting Transus — interface + validatie.
//
// ⚠️ FORMAT-STATUS: het exacte Transus-formaat (fixed-width record-layout of
// TransusXML zoals de orderbev) is nog NIET bekend; er is geen historisch
// voorbeeld in docs/transus/voorbeelden/. buildKarpiVerzendbericht() gooit
// daarom tot Task 12 een expliciete fout, zodat dit nooit stilletjes een
// verkeerd bericht produceert. De input-interface hieronder is bevroren:
// Task 13 (edge function) bouwt hier al tegenaan.

export interface VerzendberichtRegel {
  regelnummer: number;
  gtin: string | null;
  artikelcode: string | null;
  omschrijving: string | null;
  aantal: number;
}

export interface VerzendberichtInput {
  zendingNr: string;
  /** YYYY-MM-DD */
  verzenddatum: string;
  /** YYYY-MM-DD — orders.afleverdatum (bevestigde leverdatum). */
  leverdatum: string;
  /** Klant-PO uit de inkomende EDI-order. */
  orderNumberBuyer: string;
  /** Karpi-ordernummer. */
  orderNumberSupplier: string;
  /** Karpi-GLN (NAD+SU). */
  senderGln: string;
  /** Partner factuur-GLN (NAD+IV). */
  recipientGln: string;
  /** NAD+BY. */
  buyerGln: string;
  /** NAD+DP — afleveradres. */
  deliveryPartyGln: string;
  trackingNummer: string | null;
  isTestMessage: boolean;
  regels: VerzendberichtRegel[];
}

export function valideerVerzendberichtInput(input: VerzendberichtInput): void {
  for (const veld of ['senderGln', 'recipientGln', 'buyerGln', 'deliveryPartyGln'] as const) {
    if (!input[veld]) throw new Error(`Verzendbericht: ${veld} ontbreekt`);
  }
  if (!input.orderNumberBuyer) throw new Error('Verzendbericht: orderNumberBuyer (klant-PO) ontbreekt');
  if (input.regels.length === 0) throw new Error('Verzendbericht: geen regels');
}

export function buildKarpiVerzendbericht(input: VerzendberichtInput): string {
  valideerVerzendberichtInput(input);
  // Task 12 vervangt deze throw door de echte renderer zodra het
  // Transus-voorbeeldformat beschikbaar is (zie plan, STOP-punt).
  throw new Error(
    'Verzendbericht-format nog niet gevalideerd tegen Transus — zie ' +
      'docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md Task 12',
  );
}
```

- [ ] **Step 2: Run Deno-tests**

Run: `deno test --allow-read supabase/functions/_shared/transus-formats/karpi-verzendbericht.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 3: Commit** `git commit -m "feat(edi): verzendbericht-interface + validatie (format volgt na Transus-voorbeeld)"`

### Task 12: ⛔ STOP-PUNT — format reverse-engineeren uit Transus-voorbeeld

**Dit kan een agent niet zelfstandig:** er is een voorbeeldbestand nodig uit Transus Online (alleen Miguel heeft toegang). **Pauzeer hier en vraag Miguel:**

> Download uit Transus Online een historisch **verzendbericht/pakbon** zoals het oude Windows Connect-systeem dat verstuurde (zelfde route als op 2026-04-29 voor de orderbev/factuur-voorbeelden: Handelspartners → proces "Pakbon/Verzendbericht versturen" → Bekijken en testen → bestand downloaden), bij voorkeur voor BDSK of Hornbach. Plaats het in `docs/transus/voorbeelden/verzendbericht-uit-<partner>-<berichtid>.<ext>` en vul `docs/transus/voorbeelden/README.md` aan.

Zodra het voorbeeld er ligt:

- [ ] **Step 1:** Bepaal het format-type (fixed-width zoals INVOIC, of XML zoals ORDRSP) en reverse-engineer veld-voor-veld — volg exact het recept van `transus-xml.ts` (kop-commentaar regels 1-19: format-eigenaardigheden documenteren) resp. `karpi-invoice-fixed-width.ts`.
- [ ] **Step 2:** Schrijf een fixture-test die byte-identieke output afdwingt tegen het voorbeeld (kopieer de aanpak van `karpi-invoice-fixed-width.test.ts`: `loadFixture` + `normalizeFixedWidth`).
- [ ] **Step 3:** Implementeer `buildKarpiVerzendbericht` (vervang de throw).
- [ ] **Step 4:** `deno test --allow-read supabase/functions/_shared/transus-formats/` → alles PASS. Commit: `feat(edi): verzendbericht-builder gevalideerd tegen Transus-voorbeeld <berichtid>`.
- [ ] **Step 5 (mens-stap):** valideer het gegenereerde bestand in Transus Online → Testen-tab (recept: `docs/transus/demo-rondreis.md` stappen 2-4) vóór Task 15 (cron activeren).

### Task 13: Edge function `bouw-verzendbericht-edi`

**Files:**
- Create: `supabase/functions/bouw-verzendbericht-edi/index.ts`

Spiegelt `bouw-factuur-edi` (zelfde stijl, zelfde idempotentie). Twee modi: `{order_id}` in de body (gericht, bv. handmatige herstuur) of lege body (sweep over alle kandidaten).

- [ ] **Step 1: Schrijf de function**

```typescript
// Supabase Edge Function: bouw-verzendbericht-edi
//
// Zet verzendberichten (DESADV) op de uitgaande EDI-wachtrij voor verzonden
// EDI-orders van partners met verzend_uit && transus_actief. Twee modi:
//   POST {order_id} → één order (gericht)
//   POST {}         → sweep: alle kandidaten zonder bestaand verzendbericht
// De cron `transus-send` verstuurt de payload daarna dom via M10100.
// Spiegelt bouw-factuur-edi (idempotente insert op (berichttype, bron_tabel, bron_id)).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildKarpiVerzendbericht,
  type VerzendberichtInput,
} from '../_shared/transus-formats/karpi-verzendbericht.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // Cron-aanroepen dragen ?token=; handmatige aanroepen een auth-header.
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const expectedToken = Deno.env.get('CRON_TOKEN')
  const heeftAuth = !!req.headers.get('authorization')
  if (!heeftAuth && (!expectedToken || token !== expectedToken)) {
    return json(401, { error: 'Unauthorized' })
  }

  try {
    let orderId = 0
    try {
      const body = await req.json()
      orderId = Number(body?.order_id ?? 0)
    } catch { /* lege body = sweep */ }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    const kandidaten = orderId > 0 ? [orderId] : await zoekKandidaten(sb)

    const results: Array<{ order_id: number; status: string; uitgaandId?: number; error?: string }> = []
    for (const id of kandidaten) {
      try {
        results.push(await verwerkOrder(sb, id))
      } catch (e) {
        results.push({ order_id: id, status: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    }
    return json(200, { verwerkt: results.length, results })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})

/** Verzonden EDI-orders van verzend_uit-partners zonder bestaand verzendbericht. */
// deno-lint-ignore no-explicit-any
async function zoekKandidaten(sb: any): Promise<number[]> {
  const { data: configs, error: cfgErr } = await sb
    .from('edi_handelspartner_config')
    .select('debiteur_nr')
    .eq('transus_actief', true)
    .eq('verzend_uit', true)
  if (cfgErr) throw cfgErr
  const debiteurNrs = (configs ?? []).map((c: { debiteur_nr: number }) => c.debiteur_nr)
  if (debiteurNrs.length === 0) return []

  const { data: orders, error: ordErr } = await sb
    .from('orders')
    .select('id')
    .eq('status', 'Verzonden')
    .eq('bron_systeem', 'edi')
    .in('debiteur_nr', debiteurNrs)
  if (ordErr) throw ordErr
  const orderIds = (orders ?? []).map((o: { id: number }) => o.id)
  if (orderIds.length === 0) return []

  const { data: bestaande, error: bestErr } = await sb
    .from('edi_berichten')
    .select('bron_id')
    .eq('richting', 'uit')
    .eq('berichttype', 'verzendbericht')
    .eq('bron_tabel', 'orders')
    .in('bron_id', orderIds)
    .not('status', 'in', '("Fout","Geannuleerd")')
  if (bestErr) throw bestErr
  const al = new Set((bestaande ?? []).map((b: { bron_id: number }) => b.bron_id))
  return orderIds.filter((id: number) => !al.has(id))
}

// deno-lint-ignore no-explicit-any
async function verwerkOrder(sb: any, orderId: number) {
  // 1. Order + partner-config + inkomend bericht (voor klant-PO).
  const { data: order, error: ordErr } = await sb
    .from('orders')
    .select('id, order_nr, debiteur_nr, status, bron_systeem, afleverdatum, ' +
      'besteller_gln, factuuradres_gln, afleveradres_gln, klant_referentie')
    .eq('id', orderId)
    .maybeSingle()
  if (ordErr) throw ordErr
  if (!order) throw new Error(`Order ${orderId} niet gevonden`)
  if (order.bron_systeem !== 'edi') return { order_id: orderId, status: 'skip_geen_edi_order' }
  if (order.status !== 'Verzonden') return { order_id: orderId, status: 'skip_niet_verzonden' }

  const { data: cfg } = await sb
    .from('edi_handelspartner_config')
    .select('transus_actief, verzend_uit, test_modus')
    .eq('debiteur_nr', order.debiteur_nr)
    .maybeSingle()
  if (!cfg?.transus_actief || !cfg?.verzend_uit) {
    return { order_id: orderId, status: 'skip_verzend_uit_niet_actief' }
  }

  // Klant-PO uit het inkomende bericht (orders.klant_referentie is de snapshot;
  // fallback op payload_parsed.header.ordernummer als die leeg is).
  let orderNumberBuyer: string | null = order.klant_referentie
  if (!orderNumberBuyer) {
    const { data: inBericht } = await sb
      .from('edi_berichten')
      .select('payload_parsed')
      .eq('order_id', orderId)
      .eq('richting', 'in')
      .eq('berichttype', 'order')
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    orderNumberBuyer = inBericht?.payload_parsed?.header?.ordernummer ?? null
  }
  if (!orderNumberBuyer) throw new Error(`Order ${order.order_nr}: klant-PO onbekend`)

  // 2. Zending + regels + GTIN's.
  const { data: zRow } = await sb
    .from('zending_orders')
    .select('zendingen(zending_nr, verzenddatum, tracking_nummer)')
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle()
  const zending = zRow?.zendingen ?? null

  const { data: regels, error: regErr } = await sb
    .from('order_regels')
    .select('id, artikelnr, aantal, omschrijving, producten:artikelnr(ean_code)')
    .eq('order_id', orderId)
    .gt('aantal', 0)
  if (regErr) throw regErr
  if (!regels?.length) throw new Error(`Order ${order.order_nr}: geen regels`)

  const { data: bedrijfRow } = await sb
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').maybeSingle()
  const karpiGln: string = bedrijfRow?.waarde?.gln_eigen ?? '8715954999998'

  const input: VerzendberichtInput = {
    zendingNr: zending?.zending_nr ?? order.order_nr,
    verzenddatum: zending?.verzenddatum ?? new Date().toISOString().slice(0, 10),
    leverdatum: order.afleverdatum,
    orderNumberBuyer,
    orderNumberSupplier: order.order_nr,
    senderGln: karpiGln,
    recipientGln: order.factuuradres_gln ?? order.besteller_gln ?? '',
    buyerGln: order.besteller_gln ?? order.factuuradres_gln ?? '',
    deliveryPartyGln: order.afleveradres_gln ?? '',
    trackingNummer: zending?.tracking_nummer ?? null,
    isTestMessage: cfg.test_modus ?? false,
    regels: regels.map((r: { artikelnr: string | null; aantal: number; omschrijving: string | null; producten: { ean_code: string | null } | null }, i: number) => ({
      regelnummer: i + 1,
      gtin: r.producten?.ean_code ?? null,
      artikelcode: r.artikelnr,
      omschrijving: r.omschrijving,
      aantal: Number(r.aantal),
    })),
  }

  const payloadRaw = buildKarpiVerzendbericht(input)

  // 3. Idempotente insert (zelfde patroon als bouw-factuur-edi).
  const { data: bestaand } = await sb
    .from('edi_berichten')
    .select('id, status')
    .eq('richting', 'uit')
    .eq('berichttype', 'verzendbericht')
    .eq('bron_tabel', 'orders')
    .eq('bron_id', orderId)
    .not('status', 'in', '("Fout","Geannuleerd")')
    .maybeSingle()
  if (bestaand?.id) return { order_id: orderId, status: 'reeds_aanwezig', uitgaandId: bestaand.id }

  const { data: outRow, error: insErr } = await sb
    .from('edi_berichten')
    .insert({
      richting: 'uit',
      berichttype: 'verzendbericht',
      status: 'Wachtrij',
      debiteur_nr: order.debiteur_nr,
      order_id: orderId,
      bron_tabel: 'orders',
      bron_id: orderId,
      payload_raw: payloadRaw,
      payload_parsed: { format: 'karpi_verzendbericht', input },
      is_test: cfg.test_modus ?? false,
    })
    .select('id')
    .single()
  if (insErr) throw insErr
  return { order_id: orderId, status: 'enqueued', uitgaandId: outRow.id }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
```

**Verificatie-aandachtspunten** (check tijdens implementatie tegen `docs/database-schema.md`): exacte kolomnamen `zendingen.verzenddatum`, `zendingen.tracking_nummer` (HST schrijft tracking — zoek de kolom op; hst-send gebruikt `tracking_number` in payload_json maar de zendingen-kolom kan anders heten), `orders.klant_referentie` als klant-PO-snapshot (zo gebruikt `bouw-factuur-edi` hem: `orderNumberBuyer`-equivalent). Pas aan waar de werkelijkheid afwijkt en noteer dat in de changelog.

- [ ] **Step 2: Deno-check** — `deno check supabase/functions/bouw-verzendbericht-edi/index.ts` → 0 errors.

- [ ] **Step 3: Commit** `git commit -m "feat(edi): bouw-verzendbericht-edi edge function (DESADV-wachtrij, sweep + gericht)"`

### Task 14: verify_jwt-config + migratie voor de cron-sweep

**Files:**
- Modify: `supabase/config.toml` (verify_jwt=false voor de nieuwe function — zelfde als transus-send; check hoe bestaande functions er geconfigureerd staan en spiegel dat)
- Create: `supabase/migrations/3XX_verzendbericht_edi_cron.sql`

- [ ] **Step 1: Bepaal het vrije migratienummer** (zie "Vooraf").

- [ ] **Step 2: Schrijf de migratie**

```sql
-- Migratie 3XX: cron-sweep voor uitgaande EDI-verzendberichten (DESADV)
-- Plan: docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md (slice 4)
--
-- Elke 15 minuten: bouw-verzendbericht-edi sweep't verzonden EDI-orders van
-- partners met verzend_uit && transus_actief en zet ontbrekende verzendberichten
-- op de wachtrij. transus-send (mig 305) verstuurt ze daarna.
--
-- ⚠️ Pas schedulen NA validatie van het format in Transus' Testen-tab (Task 12
-- stap 5) — tot die tijd gooit de builder bewust een fout en zou elke sweep
-- error-results loggen.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('verzendbericht-edi-sweep');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

SELECT cron.schedule(
  'verzendbericht-edi-sweep',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/bouw-verzendbericht-edi?token='
           || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_token'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Commit** `git commit -m "feat(edi): cron-sweep migratie voor DESADV-verzendberichten (nog niet toepassen)"`

### Task 15: Activatie + docs slice 4

- [ ] **Step 1 (mens-stappen, in volgorde — rapporteer aan Miguel):**
  1. Task 12 afgerond (format gevalideerd in Transus Testen-tab).
  2. Deploy: `supabase functions deploy bouw-verzendbericht-edi --project-ref wqzeevfobwauxkalagtn`.
  3. Eénmalige gerichte test: POST met één order_id van een verzonden Hornbach/BDSK-order; controleer de wachtrij-rij, laat `transus-send` hem versturen, verifieer ontvangst bij de partner.
  4. Migratie 3XX toepassen (cron aan).
- [ ] **Step 2: Docs:** changelog-entry; `docs/database-schema.md` (cron-job vermelden); CLAUDE.md-bedrijfsregel: *"Verzendbevestiging (DESADV, slice 4 plan 2026-06-11): automatische sweep `bouw-verzendbericht-edi` (cron mig 3XX, 15 min) over orders `status='Verzonden' AND bron_systeem='edi'` met partner `verzend_uit && transus_actief`; idempotent op `(berichttype='verzendbericht', bron_tabel='orders', bron_id)`. Format-builder `karpi-verzendbericht.ts`; gooit bewust tot format-validatie."* ; `docs/transus/voorbeelden/README.md` aanvullen met het nieuwe voorbeeld.
- [ ] **Step 3: Commit** `git commit -m "docs: DESADV-verzendbevestiging (slice 4)"`

---

## Zelf-review checklist (na afronden van elke slice)

1. `cd frontend && npm run typecheck && npm run test:run` — groen (op de bekende pre-existing pickbaarheid-contracttest na).
2. `deno test --allow-read supabase/functions/_shared/transus-formats/` — groen.
3. Docs bijgewerkt (changelog verplicht; CLAUDE.md/order-lifecycle waar aangegeven).
4. Geen deploys of migratie-toepassingen zonder expliciet akkoord van Miguel — lijst aan het eind op wat er klaarstaat: welke edge functions te deployen, welke migraties toe te passen, welke mens-stappen open staan (Task 12 voorbeeld-download, Task 15 activatievolgorde).
5. NIET naar `main` mergen — branch laten staan en rapporteren.
