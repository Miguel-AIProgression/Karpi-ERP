import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { KlantCard } from '@/components/klanten/klant-card'
import { useKlanten, useVertegenwoordigers } from '@/hooks/use-klanten'

export function KlantenOverviewPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('Actief')
  const [vertegFilter, setVertegFilter] = useState<string>('')

  const { data, isLoading } = useKlanten({ search, status: statusFilter, vertegenw_code: vertegFilter || undefined })
  const { data: vertegenwoordigers } = useVertegenwoordigers()

  const klanten = data?.klanten ?? []

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
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle statussen</option>
          <option value="Actief">Actief</option>
          <option value="Inactief">Inactief</option>
        </select>
        <select
          value={vertegFilter}
          onChange={(e) => setVertegFilter(e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle vertegenwoordigers</option>
          {vertegenwoordigers?.map((v) => (
            <option key={v.code} value={v.code}>{v.naam}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-slate-400">Klanten laden...</div>
      ) : klanten.length === 0 ? (
        <div className="text-slate-400">Geen klanten gevonden</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {klanten.map((klant) => (
            <KlantCard key={klant.debiteur_nr} klant={klant} />
          ))}
        </div>
      )}
    </>
  )
}
