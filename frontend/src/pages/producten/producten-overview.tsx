import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { formatCurrency, formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { useProducten } from '@/hooks/use-producten'
import type { ProductType } from '@/lib/supabase/queries/producten'

const TYPE_OPTIONS: { value: ProductType | 'alle'; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'vast', label: 'Vaste maten' },
  { value: 'rol', label: 'Rolproducten' },
  { value: 'overig', label: 'Overig' },
]

function ProductTypeBadge({ type }: { type: ProductType | null }) {
  if (!type) return null
  return (
    <span className={cn(
      'px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
      type === 'vast' && 'bg-blue-100 text-blue-700',
      type === 'rol' && 'bg-amber-100 text-amber-700',
      type === 'overig' && 'bg-slate-100 text-slate-500',
    )}>
      {type === 'vast' ? 'Vaste maat' : type === 'rol' ? 'Rol' : 'Overig'}
    </span>
  )
}

export { ProductTypeBadge }

export function ProductenOverviewPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [productType, setProductType] = useState<ProductType | 'alle'>('alle')

  const { data, isLoading } = useProducten({ search, page, productType })
  const producten = data?.producten ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <>
      <PageHeader
        title="Producten"
        description={`${totalCount} producten`}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="Zoek op artikelnr, karpi-code, zoeksleutel..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1 bg-slate-100 rounded-[var(--radius-sm)] p-1">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setProductType(opt.value); setPage(0) }}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-sm)] transition-colors',
                productType === opt.value
                  ? 'bg-white text-slate-900 shadow-sm font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-slate-400">Producten laden...</div>
      ) : producten.length === 0 ? (
        <div className="text-slate-400">Geen producten gevonden</div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Artikelnr</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Karpi-code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Omschrijving</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Kwaliteit</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Voorraad</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Vrij</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Prijs</th>
              </tr>
            </thead>
            <tbody>
              {producten.map((p) => (
                <tr key={p.artikelnr} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/producten/${p.artikelnr}`} className="text-terracotta-500 hover:underline font-mono text-xs">
                      {p.artikelnr}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.karpi_code ?? '—'}</td>
                  <td className="px-4 py-3">{p.omschrijving}</td>
                  <td className="px-4 py-3">
                    <ProductTypeBadge type={p.product_type} />
                  </td>
                  <td className="px-4 py-3">
                    {p.zoeksleutel && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-mono">{p.zoeksleutel}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{formatNumber(p.voorraad)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'font-medium',
                      p.vrije_voorraad <= 0 && 'text-rose-500',
                      p.vrije_voorraad > 0 && p.vrije_voorraad <= 10 && 'text-amber-500',
                      p.vrije_voorraad > 10 && 'text-emerald-600',
                    )}>
                      {formatNumber(p.vrije_voorraad)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(p.verkoopprijs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalCount > 50 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-slate-500">Pagina {page + 1}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 disabled:opacity-50">Vorige</button>
            <button onClick={() => setPage(page + 1)} disabled={producten.length < 50} className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 disabled:opacity-50">Volgende</button>
          </div>
        </div>
      )}
    </>
  )
}
