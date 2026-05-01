import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import {
  useVervoerders,
  useVervoerderStats,
  useUpdateVervoerder,
} from '@/modules/logistiek/hooks/use-vervoerders'
import type { Vervoerder, VervoerderStats } from '@/modules/logistiek/queries/vervoerders'

interface VervoerderRowVm extends Vervoerder {
  stats: VervoerderStats | null
  successRate: number | null
}

function berekenSuccessRate(stats: VervoerderStats | null): number | null {
  if (!stats) return null
  const totaal = stats.hst_aantal_verstuurd + stats.hst_aantal_fout
  if (totaal === 0) return null
  return (stats.hst_aantal_verstuurd / totaal) * 100
}

export function VervoerdersOverzichtPage() {
  const navigate = useNavigate()
  const { data: vervoerders = [], isLoading } = useVervoerders()
  const { data: alleStats = [] } = useVervoerderStats()
  const updateMut = useUpdateVervoerder()

  const rijen = useMemo<VervoerderRowVm[]>(() => {
    const statsMap = new Map(alleStats.map((s) => [s.code, s]))
    return vervoerders.map((v) => {
      const stats = statsMap.get(v.code) ?? null
      return { ...v, stats, successRate: berekenSuccessRate(stats) }
    })
  }, [vervoerders, alleStats])

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Network size={22} className="text-slate-400" />
            Vervoerders
          </span>
        }
        description={`${rijen.length} vervoerder${rijen.length === 1 ? '' : 's'} geconfigureerd`}
      />

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Laden…</div>
        ) : rijen.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Nog geen vervoerders geconfigureerd.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Vervoerder</th>
                <th className="px-4 py-3 text-left font-medium">Actief</th>
                <th className="px-4 py-3 text-right font-medium">Klanten</th>
                <th className="px-4 py-3 text-right font-medium">Deze maand</th>
                <th className="px-4 py-3 text-right font-medium">Success-rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rijen.map((r) => (
                <tr
                  key={r.code}
                  onClick={() => navigate(`/logistiek/vervoerders/${r.code}`)}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{r.display_naam}</span>
                      <TypeBadge type={r.type} />
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono">{r.code}</div>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={r.actief}
                      disabled={updateMut.isPending}
                      onChange={(next) =>
                        updateMut.mutate({ code: r.code, data: { actief: next } })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.stats?.aantal_klanten ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.stats?.aantal_zendingen_deze_maand ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.successRate === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      `${r.successRate.toFixed(1)}%`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function TypeBadge({ type }: { type: 'api' | 'edi' }) {
  const styles =
    type === 'api'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-orange-100 text-orange-700'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {type}
    </span>
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
