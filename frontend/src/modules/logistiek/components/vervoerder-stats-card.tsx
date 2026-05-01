import { Users, Truck, CalendarRange, CheckCircle2 } from 'lucide-react'
import type { VervoerderStats } from '@/modules/logistiek/queries/vervoerders'

interface VervoerderStatsCardProps {
  stats: VervoerderStats | null | undefined
  isLoading?: boolean
}

function formatPercentage(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1)}%`
}

function berekenSuccessRate(stats: VervoerderStats): number | null {
  const totaal = stats.hst_aantal_verstuurd + stats.hst_aantal_fout
  if (totaal === 0) return null
  return (stats.hst_aantal_verstuurd / totaal) * 100
}

/**
 * Read-only kaart met klant/zending-statistieken + success-rate per vervoerder.
 *
 * Success-rate = `verstuurd / (verstuurd + fout) * 100`. Bij 0 zendingen of
 * EDI-vervoerders (waar `hst_aantal_*` nog 0 is) tonen we "—".
 */
export function VervoerderStatsCard({ stats, isLoading }: VervoerderStatsCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 text-sm text-slate-400">
        Statistieken laden…
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 text-sm text-slate-400">
        Geen statistieken beschikbaar.
      </div>
    )
  }

  const successRate = berekenSuccessRate(stats)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          icon={<Users size={16} className="text-slate-400" />}
          label="Klanten"
          value={stats.aantal_klanten.toLocaleString('nl-NL')}
        />
        <Stat
          icon={<Truck size={16} className="text-slate-400" />}
          label="Zendingen totaal"
          value={stats.aantal_zendingen_totaal.toLocaleString('nl-NL')}
        />
        <Stat
          icon={<CalendarRange size={16} className="text-slate-400" />}
          label="Deze maand"
          value={stats.aantal_zendingen_deze_maand.toLocaleString('nl-NL')}
        />
        <Stat
          icon={<CheckCircle2 size={16} className="text-slate-400" />}
          label="Success-rate"
          value={formatPercentage(successRate)}
          subtitle={
            successRate === null
              ? 'Geen verzonden HST-orders'
              : `${stats.hst_aantal_verstuurd} ok / ${stats.hst_aantal_fout} fout`
          }
        />
      </div>
    </div>
  )
}

interface StatProps {
  icon: React.ReactNode
  label: string
  value: string
  subtitle?: string
}

function Stat({ icon, label, value, subtitle }: StatProps) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500 mb-1">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold text-slate-800 tabular-nums">{value}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  )
}
