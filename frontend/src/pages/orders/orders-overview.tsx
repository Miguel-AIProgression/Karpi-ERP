import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatusTabs } from '@/components/orders/status-tabs'
import { OrdersTable } from '@/components/orders/orders-table'
import { useOrders, useStatusCounts } from '@/hooks/use-orders'

export function OrdersOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading } = useOrders({ status, search, page })
  const { data: statusCounts } = useStatusCounts()

  const orders = data?.orders ?? []
  const totalCount = data?.totalCount ?? 0
  const pageSize = 50
  const totalPages = Math.ceil(totalCount / pageSize)

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

      {/* Search */}
      <div className="relative w-80 mb-4">
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
      <OrdersTable orders={orders} isLoading={isLoading} />

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
