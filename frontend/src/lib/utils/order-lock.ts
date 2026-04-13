import type { OrderRegel } from '@/lib/supabase/queries/orders'

const STAGE: Record<string, number> = {
  Snijden: 0,
  Gesneden: 1,
  'In confectie': 2,
  Ingepakt: 3,
  Gereed: 3,
}

function maxStage(regel: OrderRegel): number {
  if (!regel.snijplannen?.length) return -1
  let max = -1
  for (const sp of regel.snijplannen) {
    const s = STAGE[sp.status]
    if (s !== undefined && s > max) max = s
  }
  return max
}

export type OrderLockMode = 'none' | 'afwerking-only' | 'full'

/**
 * Bepaalt de lock-modus voor een order:
 *  - 'none'            → geen regel is al gesneden, volledige bewerking toegestaan
 *  - 'afwerking-only'  → minstens één gesneden regel mist nog afwerking (alleen afwerking wijzigbaar)
 *  - 'full'            → alle gesneden regels hebben afwerking, of alles is al ingepakt (niets meer wijzigbaar)
 */
export function computeOrderLock(regels: OrderRegel[] | undefined | null): OrderLockMode {
  if (!regels || regels.length === 0) return 'none'
  const hasCut = regels.some((r) => maxStage(r) >= 1)
  if (!hasCut) return 'none'
  const afwerkingNogOpen = regels.some(
    (r) => {
      const s = maxStage(r)
      return s >= 1 && s < 3 && !r.maatwerk_afwerking
    },
  )
  return afwerkingNogOpen ? 'afwerking-only' : 'full'
}

/** Geeft per regel aan of specifiek de afwerking nog bewerkbaar is. */
export function isAfwerkingEditable(regel: OrderRegel): boolean {
  const s = maxStage(regel)
  return s >= 1 && s < 3 && !regel.maatwerk_afwerking
}
