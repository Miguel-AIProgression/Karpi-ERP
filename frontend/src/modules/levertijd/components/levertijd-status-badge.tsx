// Slot-component voor het Levertijd-Module: chip naast ordernummer/status
// die afwijking van klant-standaard zichtbaar maakt (ADR-0020 Ingreep 5).
//
// Render-regels:
//   - status `null` of `'standaard'` → render niets (default = niets bijzonders).
//   - `'eerder_dan_standaard'`       → oranje chip "Eerder".
//   - `'later_dan_standaard'`        → rode chip "Later".
//
// Tooltip via native `title`-attribute (geen tooltip-component in deze repo)
// toont snapshot-week vs actuele-week, conform OrderHeader-stijl.
//
// Hook-aanname: `useLevertijdStatus(orderId)` uit `@/modules/levertijd`
// (parallel-agent Wave 2) levert `{ data, isLoading, error }` met optioneel
// `levertijd_status`, `standaard_afleverdatum_berekend`, `afleverdatum`.
// Defensief — alle velden mogen ontbreken, dan vallen we terug op "render niets".

import { useLevertijdStatus } from '@/modules/levertijd'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import { cn } from '@/lib/utils/cn'
import type { LevertijdStatus } from '../types'

interface Props {
  orderId: number
  /** true = alleen kleur+initiaal, false (default) = met tekst-label */
  compact?: boolean
}

interface LevertijdStatusData {
  levertijd_status: LevertijdStatus | null
  standaard_afleverdatum_berekend?: string | null
  afleverdatum?: string | null
}

function weekLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const w = verzendWeekVoor(iso)
  return w ? `wk ${w.week}` : '—'
}

export function LevertijdStatusBadge({ orderId, compact = false }: Props) {
  const { data, isLoading, error } = useLevertijdStatus(orderId) as {
    data: LevertijdStatusData | null | undefined
    isLoading: boolean
    error: unknown
  }

  if (isLoading) return null
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[LevertijdStatusBadge] kon levertijd-status niet laden voor order', orderId, error)
    return null
  }
  if (!data) return null

  const status = data.levertijd_status
  if (status === null || status === undefined || status === 'standaard') {
    return null
  }

  const standaardLabel = weekLabel(data.standaard_afleverdatum_berekend ?? null)
  const actueelLabel = weekLabel(data.afleverdatum ?? null)
  const tooltip = `Klant-standaard: ${standaardLabel} — actuele: ${actueelLabel}`

  const styles =
    status === 'eerder_dan_standaard'
      ? { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Eerder', initiaal: 'E' }
      : { bg: 'bg-red-100', text: 'text-red-800', label: 'Later', initiaal: 'L' }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        styles.bg,
        styles.text,
      )}
      title={tooltip}
    >
      {compact ? styles.initiaal : styles.label}
    </span>
  )
}
