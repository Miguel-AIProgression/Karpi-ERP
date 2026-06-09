import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Download } from 'lucide-react'
import { exporterenNaarExcel } from '@/lib/orders/export-orders'
import { PageHeader } from '@/components/layout/page-header'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { StatusTabs } from '@/components/orders/status-tabs'
import { OrdersTable } from '@/components/orders/orders-table'
import { DebiteurTeBevestigenBanner } from '@/components/orders/debiteur-te-bevestigen-banner'
import { useOrders, useStatusCounts, useOrderKlantOpties } from '@/hooks/use-orders'
import { useFacturenVoorOrders } from '@/modules/facturatie'
import { EdiTeKoppelenBanner } from '@/modules/edi'
import type { OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'

const KANAAL_OPTIES = [
  { value: 'handmatig', label: 'Handmatig' },
  { value: 'edi',       label: 'EDI' },
  { value: 'shopify',   label: 'Shopify' },
  { value: 'lightspeed', label: 'Lightspeed' },
  { value: 'email',     label: 'E-mail' },
  { value: 'oud_systeem', label: 'Oud systeem' },
]

export function OrdersOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')
  const [klantSelectie, setKlantSelectie] = useState<string[]>([])
  const [bronSelectie, setBronSelectie] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState<OrderSortField>('orderdatum')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [exportBezig, setExportBezig] = useState(false)

  const handleSort = (field: OrderSortField) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir(field === 'klant_naam' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  const debiteurNrs = useMemo(
    () => klantSelectie.map((v) => Number(v)).filter((n) => Number.isFinite(n)),
    [klantSelectie],
  )

  async function handleExport() {
    setExportBezig(true)
    try {
      await exporterenNaarExcel({ status, search, debiteurNrs, bronSystemen: bronSelectie, sortBy, sortDir })
    } finally {
      setExportBezig(false)
    }
  }

  const { data, isLoading } = useOrders({ status, search, debiteurNrs, bronSystemen: bronSelectie, page, sortBy, sortDir })
  const { data: statusCounts } = useStatusCounts()
  const { data: klantOptiesData } = useOrderKlantOpties()

  // Klant-opties komen uit feitelijke order-data — debiteur_nr (als string,
  // matcht het MultiSelect-API) wordt als value gebruikt zodat de ingebouwde
  // zoekbalk én op naam én op debiteur-nummer matcht.
  const klantOpties = useMemo(
    () =>
      (klantOptiesData ?? []).map((k) => ({
        value: String(k.debiteur_nr),
        label: `${k.klant_naam} (#${k.debiteur_nr})`,
      })),
    [klantOptiesData],
  )

  const orders = data?.orders ?? []
  const totalCount = data?.totalCount ?? 0
  const pageSize = 50
  const totalPages = Math.ceil(totalCount / pageSize)

  const { data: facturenPerOrder } = useFacturenVoorOrders(orders.map((o) => o.id))

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${totalCount} orders`}
        actions={
          <Link
            to="/orders/nieuw"
            className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors"
          >
            <Plus size={16} />
            Nieuwe order
          </Link>
        }
      />

      {/* Safety-net: inkomende EDI-orders die niet aan een klant gekoppeld konden worden */}
      <EdiTeKoppelenBanner />

      {/* Safety-net: orders met onzekere (fuzzy) debiteur-match — mig 322 */}
      <DebiteurTeBevestigenBanner
        onBekijk={() => {
          setStatus('Debiteur te bevestigen')
          setPage(0)
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="Zoek op order, klant, referentie..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        <MultiSelectDropdown
          placeholder="Alle klanten"
          options={klantOpties}
          selected={klantSelectie}
          onChange={(next) => {
            setKlantSelectie(next)
            setPage(0)
          }}
          zoekbaar
        />

        <MultiSelectDropdown
          placeholder="Alle kanalen"
          options={KANAAL_OPTIES}
          selected={bronSelectie}
          onChange={(next) => {
            setBronSelectie(next)
            setPage(0)
          }}
        />

        <button
          onClick={handleExport}
          disabled={exportBezig || totalCount === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 disabled:opacity-40 transition-colors"
          title="Exporteer gefilterde orders naar Excel"
        >
          <Download size={15} />
          {exportBezig ? 'Exporteren…' : `Excel (${totalCount})`}
        </button>
      </div>

      {/* Status tabs */}
      <StatusTabs
        selected={status}
        onSelect={(s) => {
          setStatus(s)
          setPage(0)
        }}
        counts={statusCounts ?? []}
      />

      {/* Table */}
      <OrdersTable
        orders={orders}
        isLoading={isLoading}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
        facturenPerOrder={facturenPerOrder}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-slate-500">
            Pagina {page + 1} van {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 disabled:opacity-50 hover:bg-slate-50"
            >
              Vorige
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 disabled:opacity-50 hover:bg-slate-50"
            >
              Volgende
            </button>
          </div>
        </div>
      )}
    </>
  )
}
