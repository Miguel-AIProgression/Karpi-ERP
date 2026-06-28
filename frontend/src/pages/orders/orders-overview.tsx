import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, Download } from 'lucide-react'
import { exporterenNaarExcel } from '@/lib/orders/export-orders'
import { PageHeader } from '@/components/layout/page-header'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { StatusFilterDropdown } from '@/components/orders/status-filter-dropdown'
import { VereistActieKaart } from '@/components/orders/vereist-actie-kaart'
import { FASE_STATUSES, FILTER_STATUSES, ALLE_STATUS } from '@/lib/orders/order-status-groepen'
import { OrdersTable } from '@/components/orders/orders-table'
import { MancoTab } from '@/modules/orders/components/manco-tab'
import { useOrders, useStatusCounts, useOrderKlantOpties } from '@/hooks/use-orders'
import { useFacturenVoorOrders } from '@/modules/facturatie'
import { useSnijHaalbaarheid } from '@/modules/snijplanning'
import { EdiTeKoppelenBanner } from '@/modules/edi'
import { ShopifySyncStatusBanner } from '@/components/orders/shopify-sync-status-banner'
import { useAuth } from '@/hooks/use-auth'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') ?? 'Alle'

  function setStatus(nieuw: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (nieuw === 'Alle') next.delete('status')
        else next.set('status', nieuw)
        return next
      },
      { replace: false },
    )
  }

  const [search, setSearch] = useState('')
  const [klantSelectie, setKlantSelectie] = useState<string[]>([])
  const [bronSelectie, setBronSelectie] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState<OrderSortField>('orderdatum')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [exportBezig, setExportBezig] = useState(false)

  function kiesStatus(nieuw: string) {
    setStatus(nieuw)
    setPage(0)
    // Achterstallige verzendingen: standaard langst-over-tijd bovenaan.
    if (nieuw === 'Verzendweek verstreken') {
      setSortBy('afleverdatum')
      setSortDir('asc')
    }
  }

  const handleSort = (field: OrderSortField) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      // afleverdatum (Verzendweek): standaard oplopend = soonest delivery first
      setSortDir(field === 'klant_naam' || field === 'afleverdatum' ? 'asc' : 'desc')
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
  const { data: statusCountsResult } = useStatusCounts()
  const statusCounts = statusCountsResult?.counts
  const allOrdersCount = statusCountsResult?.totalOrders
  const { data: klantOptiesData } = useOrderKlantOpties()

  // Fase-as voor de status-dropdown: 'Alle' + de order-status zelf, met counts.
  const statusOpties = useMemo(() => {
    const countMap = new Map((statusCounts ?? []).map((c) => [c.status, c.aantal]))
    return [
      { value: ALLE_STATUS, count: allOrdersCount ?? 0 },
      ...FASE_STATUSES.map((s) => ({ value: s, count: countMap.get(s) ?? 0 })),
      // Informatieve filters onderaan, gescheiden door een lijntje.
      ...FILTER_STATUSES.map((s, i) => ({
        value: s,
        count: countMap.get(s) ?? 0,
        divider: i === 0,
      })),
    ]
  }, [statusCounts, allOrdersCount])

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
  const { perOrder: snijHaalbaarheidPerOrder } = useSnijHaalbaarheid()
  const { isExternRep } = useAuth()

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${totalCount} orders`}
        actions={
          isExternRep ? undefined : (
            <Link
              to="/orders/nieuw"
              className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors"
            >
              <Plus size={16} />
              Nieuwe order
            </Link>
          )
        }
      />

      {/* Safety-net: inkomende EDI-orders die niet aan een klant gekoppeld konden worden
          (geen order-status — staat los van de Vereist actie-kaart hieronder) */}
      <EdiTeKoppelenBanner />

      {/* Storingssignaal: de geplande Shopify-orderpoll loopt vast of faalt */}
      <ShopifySyncStatusBanner />

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

        <StatusFilterDropdown
          selected={status}
          options={statusOpties}
          onSelect={kiesStatus}
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

      {/* Meldingen: status-overstijgende vlaggen die om actie vragen (alleen >0) */}
      <VereistActieKaart
        counts={statusCounts ?? []}
        selected={status}
        onSelect={kiesStatus}
      />

      {/* De 'Manco'-tab toont de regel-niveau werklijst (binnendienst-resolutie),
          niet de orderlijst. Alle andere tabs tonen de normale tabel. */}
      {status === 'Manco' ? (
        <MancoTab />
      ) : (
        <OrdersTable
          orders={orders}
          isLoading={isLoading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          facturenPerOrder={facturenPerOrder}
          snijHaalbaarheidPerOrder={snijHaalbaarheidPerOrder}
        />
      )}

      {/* Pagination */}
      {status !== 'Manco' && totalPages > 1 && (
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
