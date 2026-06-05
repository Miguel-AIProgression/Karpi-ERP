import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Download, Plus } from 'lucide-react'
import * as XLSX from 'xlsx'
import { PageHeader } from '@/components/layout/page-header'
import { DebiteurCard } from '../components/debiteur-card'
import { DebiteurAddDialog } from '../components/debiteur-add-dialog'
import { useDebiteuren, usePrijslijstHeadersList } from '../hooks/use-debiteuren'
import { fetchDebiteuren } from '../queries/debiteuren'
import { useVertegenwoordigers } from '@/hooks/use-medewerkers'
import { useInkoopgroepen } from '@/hooks/use-inkoopgroepen'

const PAGE_SIZE = 50

export function DebiteurenOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [exporting, setExporting] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const search = searchParams.get('q') ?? ''
  const statusFilter = searchParams.get('status') ?? 'Actief'
  const vertegFilter = searchParams.get('verteg') ?? ''
  const ediFilter = (searchParams.get('edi') ?? '') as '' | 'edi' | 'niet_edi'
  const inkoopgroepFilter = searchParams.get('inkoopgroep') ?? ''
  const prijslijstFilter = searchParams.get('prijslijst') ?? ''

  function setParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      return next
    }, { replace: true })
    setPageSize(PAGE_SIZE)
  }

  const { data, isLoading } = useDebiteuren({
    search,
    status: statusFilter,
    vertegenw_code: vertegFilter || undefined,
    edi_filter: ediFilter || undefined,
    inkoopgroep_code: inkoopgroepFilter || undefined,
    prijslijst_filter: prijslijstFilter || undefined,
    pageSize,
  })
  const { data: vertegenwoordigers } = useVertegenwoordigers()
  const { data: inkoopgroepen } = useInkoopgroepen()
  const { data: prijslijsten } = usePrijslijstHeadersList()

  const debiteuren = data?.debiteuren ?? []
  const totalCount = data?.totalCount ?? 0
  const hasMore = debiteuren.length < totalCount

  async function handleExport() {
    setExporting(true)
    try {
      const result = await fetchDebiteuren({
        search,
        status: statusFilter || undefined,
        vertegenw_code: vertegFilter || undefined,
        edi_filter: ediFilter || undefined,
        inkoopgroep_code: inkoopgroepFilter || undefined,
        prijslijst_filter: prijslijstFilter || undefined,
        pageSize: 9999,
      })

      const rows = result.debiteuren.map((d) => ({
        'Debiteur nr': d.debiteur_nr,
        'Naam': d.naam,
        'Plaats': d.plaats ?? '',
        'Status': d.status,
        'Vertegenwoordiger': d.vertegenwoordiger_naam ?? '',
        'Prijslijst nr': d.prijslijst_nr ?? '',
        'Prijslijst naam': d.prijslijst_naam ?? '',
        'Inkoopgroep': '',
        'EDI actief': d.edi_actief ? 'Ja' : 'Nee',
        'Omzet YTD (€)': d.omzet_ytd,
        'Orders YTD': d.aantal_orders_ytd,
      }))

      const ws = XLSX.utils.json_to_sheet(rows)

      const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
        wch: Math.max(
          key.length,
          ...rows.map((r) => String(r[key as keyof typeof r] ?? '').length),
        ) + 2,
      }))
      ws['!cols'] = colWidths

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Klanten')

      const datum = new Date().toISOString().slice(0, 10)
      const filterLabel = prijslijstFilter === 'geen'
        ? '_geen-prijslijst'
        : prijslijstFilter
          ? `_prijslijst-${prijslijstFilter}`
          : ''
      const statusLabel = statusFilter ? `_${statusFilter.toLowerCase()}` : ''
      const filename = `klanten${statusLabel}${filterLabel}_${datum}.xlsx`

      XLSX.writeFile(wb, filename)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Klanten"
        description={`${data?.totalCount ?? 0} klanten`}
      />

      {showAdd && <DebiteurAddDialog onClose={() => setShowAdd(false)} />}

      {/* Filters + export */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Zoek op naam of nummer..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setParam('status', e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle statussen</option>
          <option value="Actief">Actief</option>
          <option value="Inactief">Inactief</option>
        </select>
        <select
          value={vertegFilter}
          onChange={(e) => setParam('verteg', e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle vertegenwoordigers</option>
          {vertegenwoordigers?.map((v) => (
            <option key={v.code} value={v.code}>{v.naam}</option>
          ))}
        </select>
        <select
          value={ediFilter}
          onChange={(e) => setParam('edi', e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle EDI-statussen</option>
          <option value="edi">EDI-klanten</option>
          <option value="niet_edi">Niet-EDI</option>
        </select>
        <select
          value={inkoopgroepFilter}
          onChange={(e) => setParam('inkoopgroep', e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle inkoopgroepen</option>
          {inkoopgroepen?.map((g) => (
            <option key={g.code} value={g.code}>
              {g.naam} ({g.aantal_leden})
            </option>
          ))}
        </select>
        <select
          value={prijslijstFilter}
          onChange={(e) => setParam('prijslijst', e.target.value)}
          className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
        >
          <option value="">Alle prijslijsten</option>
          <option value="geen">— Niet gekoppeld aan prijslijst</option>
          {prijslijsten?.map((p) => (
            <option key={p.nr} value={p.nr}>{p.naam}</option>
          ))}
        </select>

        {/* Acties — rechts uitlijnen */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || totalCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <Download size={15} />
            {exporting ? 'Exporteren...' : `Exporteer${totalCount > 0 ? ` (${totalCount})` : ''}`}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors"
          >
            <Plus size={15} />
            Nieuwe klant
          </button>
        </div>
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
