// Selectie-state voor de Pick & Ship multi-select — het context-object + hooks
// (géén component, zodat react-refresh blij blijft; de Provider-component leeft
// in `pick-selectie-provider.tsx`). Spiegelt het VervoerderResolutie-context-
// patroon in modules/logistiek.
//
// Eén plek host de set geselecteerde order-ids; de checkboxes (OrderPickCard +
// KlantClusterBlok) en de actiebalk (PickSelectieBalk) lezen 'm via context,
// zodat de tussenliggende secties (PickWeekSectie / PickDagOrdersSectie) niets
// van selectie hoeven te weten.
//
// Bewust géén useEffect (https://react.dev/learn/you-might-not-need-an-effect):
//   - Reset bij tab-/vervoerderfilter-wissel = "adjust state during render"
//     (guarded setState op een gewijzigde `resetKey`). Scope = actieve week-tab
//     (besluit 2026-06-17).
//   - De naar-buiten zichtbare selectie is een afgeleide ("schone") set: ids die
//     niet meer selecteerbaar zijn (order verdween, kreeg een intake-gate, of
//     startte zojuist een pickronde) vallen weg vóór de balk/start ze ziet,
//     zónder de onderliggende keuze te wissen.
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export interface PickSelectieValue {
  /** Geselecteerde, nog-selecteerbare order-ids (afgeleide "schone" set). */
  selectedIds: Set<number>
  /** Mag deze order aangevinkt worden? (pickbaar, niet geblokkeerd, niet al in pickronde) */
  isSelectable: (orderId: number) => boolean
  isSelected: (orderId: number) => boolean
  /** Toggle één order. No-op als de order niet selecteerbaar is. */
  toggle: (orderId: number) => void
  /** Zet meerdere orders tegelijk aan/uit (bundel-checkbox). Negeert niet-selecteerbare. */
  setMany: (orderIds: number[], value: boolean) => void
  clear: () => void
  count: number
}

export const PickSelectieContext = createContext<PickSelectieValue | null>(null)

/**
 * State-hook die de pagina (pick-overview) host. `selectableIds` is de set
 * orders die op dit moment een pickronde kunnen starten; `resetKey` wisselt bij
 * tab-/filterwissel zodat de selectie dan leegt.
 */
export function usePickSelectieState(
  resetKey: string,
  selectableIds: Set<number>,
): PickSelectieValue {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())

  // Reset bij wissel van week-tab of vervoerder-filter, vóór de children
  // renderen — guarded setState tijdens render (geen effect, geen cascade).
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (selectedIds.size > 0) setSelectedIds(new Set())
  }

  const toggle = useCallback(
    (orderId: number) => {
      if (!selectableIds.has(orderId)) return
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(orderId)) next.delete(orderId)
        else next.add(orderId)
        return next
      })
    },
    [selectableIds],
  )

  const setMany = useCallback(
    (orderIds: number[], value: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of orderIds) {
          if (!selectableIds.has(id)) continue
          if (value) next.add(id)
          else next.delete(id)
        }
        return next
      })
    },
    [selectableIds],
  )

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  // Afgeleide "schone" selectie: filter stale ids weg zonder de onderliggende
  // keuze te muteren. Referentieel stabiel (return `selectedIds`) zolang alles
  // selecteerbaar blijft → geen onnodige re-renders.
  const cleanSelectedIds = useMemo(() => {
    let alleSelectable = true
    for (const id of selectedIds) {
      if (!selectableIds.has(id)) {
        alleSelectable = false
        break
      }
    }
    if (alleSelectable) return selectedIds
    const next = new Set<number>()
    for (const id of selectedIds) if (selectableIds.has(id)) next.add(id)
    return next
  }, [selectedIds, selectableIds])

  const isSelectable = useCallback(
    (orderId: number) => selectableIds.has(orderId),
    [selectableIds],
  )

  return useMemo(
    () => ({
      selectedIds: cleanSelectedIds,
      isSelectable,
      isSelected: (orderId: number) => cleanSelectedIds.has(orderId),
      toggle,
      setMany,
      clear,
      count: cleanSelectedIds.size,
    }),
    [cleanSelectedIds, isSelectable, toggle, setMany, clear],
  )
}

/**
 * Consumer voor de checkboxes. Buiten een provider → null, zodat OrderPickCard
 * elders zonder selectie-UI herbruikbaar blijft.
 */
export function usePickSelectie(): PickSelectieValue | null {
  return useContext(PickSelectieContext)
}
