// PickSelectieProvider — levert de multi-select-state (gehost door pick-overview
// via `usePickSelectieState`) aan de diepe consumers (OrderPickCard +
// KlantClusterBlok). Context-object + hooks staan in `pick-selectie-context.ts`.
import { type ReactNode } from 'react'
import { PickSelectieContext, type PickSelectieValue } from './pick-selectie-context'

export function PickSelectieProvider({
  value,
  children,
}: {
  value: PickSelectieValue
  children: ReactNode
}) {
  return <PickSelectieContext.Provider value={value}>{children}</PickSelectieContext.Provider>
}
