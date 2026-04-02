import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useVertegOverview } from '@/hooks/use-vertegenwoordigers'

type Periode = 'YTD' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

const PERIODES: { key: Periode; label: string }[] = [
  { key: 'YTD', label: 'YTD' },
  { key: 'Q1', label: 'Q1' },
  { key: 'Q2', label: 'Q2' },
  { key: 'Q3', label: 'Q3' },
  { key: 'Q4', label: 'Q4' },
]

type SortField = 'omzet' | 'naam' | 'aantal_klanten' | 'open_orders'

export function VertegenwoordigersOverviewPage() {
  const [periode, setPeriode] = useState<Periode>('YTD')
  const [sortBy, setSortBy] = useState<SortField>('omzet')
  const [sortAsc, setSortAsc] = useState(false)

  const { data: reps, isLoading } = useVertegOverview(periode)

  const sorted = [...(reps ?? [])].sort((a, b) => {
    const dir = sortAsc ? 1 : -1
    if (sortBy === 'naam') return dir * a.naam.localeCompare(b.naam)
    return dir * ((a[sortBy] as number) - (b[sortBy] as number))
  })

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(field)
      setSortAsc(field === 'naam')
    }
  }

  const sortIcon = (field: SortField) => {
    if (sortBy !== field) return ''
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  return (
    <>
      <PageHeader
        title="Vertegenwoordigers"
        description={`${reps?.length ?? 0} vertegenwoordigers`}
      />

      {/* Periode filter */}
      <div className="flex items-center gap-2 mb-6">
        {PERIODES.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriode(p.key)}
            className={`px-3 py-1.5 text-sm rounded-[var(--radius-sm)] font-medium transition-colors ${
              periode === p.key
                ? 'bg-terracotta-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-slate-400">Laden...</div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-10">#</th>
                <th
                  className="text-left px-4 py-2 font-medium text-slate-600 cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('naam')}
                >
                  Naam{sortIcon('naam')}
                </th>
                <th
                  className="text-right px-4 py-2 font-medium text-slate-600 cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('omzet')}
                >
                  Omzet{sortIcon('omzet')}
                </th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">%</th>
                <th
                  className="text-right px-4 py-2 font-medium text-slate-600 cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('aantal_klanten')}
                >
                  Klanten{sortIcon('aantal_klanten')}
                </th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Tiers</th>
                <th
                  className="text-right px-4 py-2 font-medium text-slate-600 cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('open_orders')}
                >
                  Open orders{sortIcon('open_orders')}
                </th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Gem. order</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((rep, idx) => (
                <tr
                  key={rep.code}
                  className={`border-b border-slate-50 hover:bg-slate-50 ${!rep.actief ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-2.5 text-slate-400 font-medium">{idx + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/vertegenwoordigers/${rep.code}`}
                      className="text-terracotta-500 hover:underline font-medium"
                    >
                      {rep.naam}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">({rep.code})</span>
                    {!rep.actief && (
                      <StatusBadge status="Inactief" type="order" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(rep.omzet)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{rep.pct_totaal.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right">{rep.aantal_klanten}</td>
                  <td className="px-4 py-2.5 text-center">
                    <TierBadges gold={rep.tier_gold} silver={rep.tier_silver} bronze={rep.tier_bronze} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {rep.open_orders > 0 ? (
                      <span className="text-amber-600 font-medium">{rep.open_orders}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">
                    {formatCurrency(rep.gem_orderwaarde)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TierBadges({ gold, silver, bronze }: { gold: number; silver: number; bronze: number }) {
  if (gold === 0 && silver === 0 && bronze === 0) {
    return <span className="text-xs text-slate-300">—</span>
  }
  return (
    <div className="flex items-center justify-center gap-1.5 text-xs">
      {gold > 0 && <span className="text-amber-500 font-medium">G:{gold}</span>}
      {silver > 0 && <span className="text-slate-400 font-medium">S:{silver}</span>}
      {bronze > 0 && <span className="text-orange-400 font-medium">B:{bronze}</span>}
    </div>
  )
}
