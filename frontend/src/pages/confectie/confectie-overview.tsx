import { useState } from 'react'
import { Search, Factory, CheckCircle2, Package } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ConfectieTabel } from '@/components/confectie/confectie-tabel'
import { useConfectieOrders, useConfectieStatusCounts } from '@/hooks/use-confectie'
import { cn } from '@/lib/utils/cn'

const CONFECTIE_STATUSES = [
  'Alle',
  'Wacht op materiaal',
  'In productie',
  'Kwaliteitscontrole',
  'Gereed',
  'Geannuleerd',
]

export function ConfectieOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading } = useConfectieOrders({ status, search, page })
  const { data: statusCounts } = useConfectieStatusCounts()

  const countMap = new Map((statusCounts ?? []).map((c) => [c.status, c.aantal]))
  const allCount = (statusCounts ?? []).reduce((sum, c) => sum + c.aantal, 0)

  const wachtCount = countMap.get('Wacht op materiaal') ?? 0
  const inProductieCount = countMap.get('In productie') ?? 0
  const gereedCount = countMap.get('Gereed') ?? 0

  const stats = [
    { label: 'Wacht op afwerking', value: wachtCount + inProductieCount, icon: Factory, color: 'text-amber-600' },
    { label: 'Afgewerkt', value: gereedCount, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Kwaliteitscontrole', value: countMap.get('Kwaliteitscontrole') ?? 0, icon: Package, color: 'text-purple-600' },
  ]

  const totalPages = Math.ceil((data?.totalCount ?? 0) / 50)

  return (
    <>
      <PageHeader
        title="Confectie & Afwerking"
        description="Overzicht gesneden producten — afwerken en inpakken"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="Zoek op product, klant, sticker..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-4">
        {CONFECTIE_STATUSES.map((s) => {
          const count = s === 'Alle' ? allCount : (countMap.get(s) ?? 0)
          const isActive = status === s
          return (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(0) }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-terracotta-500 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {s}
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full', isActive ? 'bg-white/20' : 'bg-slate-200')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Data table */}
      <ConfectieTabel
        rows={data?.confecties ?? []}
        isLoading={isLoading}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-slate-500">
            {data?.totalCount ?? 0} resultaten — pagina {page + 1} van {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Vorige
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Volgende
            </button>
          </div>
        </div>
      )}
    </>
  )
}
