import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { DebiteurCard } from '../components/debiteur-card'
import { useDebiteuren } from '../hooks/use-debiteuren'
import { useVertegenwoordigers } from '@/hooks/use-medewerkers'
import { useInkoopgroepen } from '@/hooks/use-inkoopgroepen'

const PAGE_SIZE = 50

export function DebiteurenOverviewPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('Actief')
  const [vertegFilter, setVertegFilter] = useState<string>('')
  const [ediFilter, setEdiFilter] = useState<'' | 'edi' | 'niet_edi'>('')
  const [inkoopgroepFilter, setInkoopgroepFilter] = useState<string>('')
  const [pageSize, setPageSize] = useState(PAGE_SIZE)

  const { data, isLoading } = useDebiteuren({
    search,
    status: statusFilter,
    vertegenw_code: vertegFilter || undefined,
    edi_filter: ediFilter || undefined,
    inkoopgroep_code: inkoopgroepFilter || undefined,
    pageSize,
  })
  const { data: vertegenwoordigers } = useVertegenwoordigers()
  const { data: inkoopgroepen } = useInkoopgroepen()

  const debiteuren = data?.debiteuren ?? []
  const totalCount = data?.totalCount ?? 0
  const hasMore = debiteuren.length < totalCount

  function handleFilterChange(setter: (v: string) => void, value: string) {
    setter(value)
    setPageSize(PAGE_SIZE)
  }

  return (
    <>
      <PageHeader
        title="Klanten"
        description={`${data?.totalCount ?? 0} klanten`}
      />

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op naam of nummer..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleFilterChange(setStatusFilter, e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle statussen</option>
          <option value="Actief">Actief</option>
          <option value="Inactief">Inactief</option>
        </select>
        <select
          value={vertegFilter}
          onChange={(e) => handleFilterChange(setVertegFilter, e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle vertegenwoordigers</option>
          {vertegenwoordigers?.map((v) => (
            <option key={v.code} value={v.code}>{v.naam}</option>
          ))}
        </select>
        <select
          value={ediFilter}
          onChange={(e) => handleFilterChange(setEdiFilter as (v: string) => void, e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle EDI-statussen</option>
          <option value="edi">EDI-klanten</option>
          <option value="niet_edi">Niet-EDI</option>
        </select>
        <select
          value={inkoopgroepFilter}
          onChange={(e) => handleFilterChange(setInkoopgroepFilter, e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle inkoopgroepen</option>
          {inkoopgroepen?.map((g) => (
            <option key={g.code} value={g.code}>
              {g.naam} ({g.aantal_leden})
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {isLoading && debiteuren.length === 0 ? (
        <div className="text-slate-400">Klanten laden...</div>
      ) : debiteuren.length === 0 ? (
        <div className="text-slate-400">Geen klanten gevonden</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {debiteuren.map((debiteur) => (
              <DebiteurCard key={debiteur.debiteur_nr} debiteur={debiteur} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setPageSize(ps => ps + PAGE_SIZE)}
                disabled={isLoading}
                className="px-6 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {isLoading ? 'Laden...' : `Meer laden (${debiteuren.length} van ${totalCount})`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
