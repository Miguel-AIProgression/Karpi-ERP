// frontend/src/modules/logistiek/hooks/use-vervoerder-keuze.ts
//
// ADR-0008 Phase 5 — useVervoerderKeuzeVoorOrder + useSetOrderVervoerderOverride
//
// Bouwt bovenop:
//   - useEffectieveVervoerderPerOrderregel  (queries/orderregel-vervoerder, cache-deelt key)
//   - aggregeerVervoerderKeuzeVoorOrder     (queries/vervoerder-keuze, pure TS-functie)
//   - setOrderVervoerderOverride            (queries/vervoerder-keuze, bulk-RPC)

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  setOrderVervoerderOverride,
  aggregeerVervoerderKeuzeVoorOrder,
  type OrderVervoerderAggregaat,
} from '../queries/vervoerder-keuze'
import { useEffectieveVervoerderPerOrderregel } from './use-orderregel-vervoerder'

export type { BulkOverrideResultaat } from '../queries/vervoerder-keuze'
export type { OrderVervoerderAggregaat }

/**
 * Gecombineerde hook: per-orderregel data + order-niveau aggregaat in één.
 *
 * "Keuze" = wat de DB rapporteert als gekozen of geëvalueerd; zie
 * `useEffectieveVervoerderPerOrderregel` voor de per-regellaag waarop dit
 * aggregeert.
 *
 * Cache-key is dezelfde als `useEffectieveVervoerderPerOrderregel` —
 * `['logistiek', 'orderregel-vervoerder', orderId]` — zodat invalidations
 * vanuit `useSetOrderVervoerderOverride.onSuccess` automatisch ook deze hook
 * refreshen zonder extra wiring. `staleTime` wordt bepaald door de inner hook
 * (mig 219: STALE_30_SEC) — deze hook voegt geen eigen cache toe.
 *
 * `aggregaat` is een afgeleide useMemo — nooit undefined, synchroon beschikbaar
 * zodra de query data heeft. Zolang de query laadt is `aggregaat` gebaseerd op
 * een lege array (`{soort: 'leeg'}`).
 */
export function useVervoerderKeuzeVoorOrder(orderId: number | null | undefined) {
  const perRegelQuery = useEffectieveVervoerderPerOrderregel(orderId)

  const aggregaat: OrderVervoerderAggregaat = useMemo(
    () => aggregeerVervoerderKeuzeVoorOrder(perRegelQuery.data ?? []),
    [perRegelQuery.data],
  )

  return { ...perRegelQuery, aggregaat }
}

/**
 * Bulk-override mutatie: zet vervoerder op alle regels van een order via één
 * RPC-transactie (`set_orderregel_vervoerder_override_voor_order`, mig 227).
 * NULL wist de override (terug naar de verzendregel-evaluator).
 *
 * **Typed-error-pattern (geen exception bij geblokkeerde regels):** de mutatie
 * resolved met `BulkOverrideResultaat[]` waarin geblokkeerde regels (al in een
 * open zending) als `resultaat='geblokkeerd_door_zending'` voorkomen — niet
 * als gegooide error. Consument moet zelf checken:
 *   `data.some(r => r.resultaat !== 'gezet')` → toon waarschuwing.
 * Echte exceptions (RLS/FK/order-niet-gevonden) komen wél via `onError`.
 *
 * `onSuccess` invalideert 6 cache-keys zodat alle pick/ship/print-views
 * meteen de nieuwe keuze reflecteren:
 *   1. ['logistiek', 'orderregel-vervoerder', orderId]  — specifieke order
 *   2. ['logistiek', 'orderregel-vervoerder']           — parent (alle orders)
 *   3. ['logistiek', 'zending-printset']                — printsticker-data
 *   4. ['logistiek', 'zending']                         — zending-detail
 *   5. ['logistiek', 'zendingen']                       — zendingen-lijst
 *   6. ['pick-ship']                                    — pick-overzicht
 */
export function useSetOrderVervoerderOverride() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      orderId,
      vervoerderCode,
    }: {
      orderId: number
      vervoerderCode: string | null
    }) => setOrderVervoerderOverride(orderId, vervoerderCode),

    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder', vars.orderId] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending-printset'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      // Mig 229 / ADR-0012: vervoerder is een dimensie van de 4D-bundel-sleutel.
      // Wijziging betekent dat orders kunnen schuiven tussen voorgestelde-bundels
      // in de Pick & Ship live preview. Zonder deze invalidate ziet de operator
      // de nieuwe bundel-card pas na de 60s staleTime — dat veroorzaakt
      // "ik koppelde de vervoerder maar zie geen bundel"-verwarring.
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })
    },
  })
}
