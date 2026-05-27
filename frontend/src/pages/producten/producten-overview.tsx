import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Link2, LayoutGrid, Layers, List } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { useProducten } from '@/hooks/use-producten'
import { UitwisselbaarTab } from './uitwisselbaar-tab'
import { ProductRow, SortHeader } from './product-row'
import { KwaliteitenGroupedView } from './kwaliteiten-grouped-view'
import { fetchKwaliteitenMetGewicht } from '@/lib/supabase/queries/kwaliteiten'
import type { ProductType, ProductSortField, SortDirection } from '@/lib/supabase/queries/producten'

export { ProductTypeBadge } from './product-row'

type OverviewTab = 'collecties' | 'uitwisselbaar'
type ViewMode = 'per_kwaliteit' | 'per_product'

const TYPE_OPTIONS: { value: ProductType | 'alle'; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'vast', label: 'Standaard maten' },
  { value: 'rol', label: 'Rollen' },
  { value: 'staaltje', label: 'Stalen' },
  { value: 'overig', label: 'Overig' },
]

const COL_COUNT = 10

export function ProductenOverviewPage() {
  const [activeTab, setActiveTab] = useState<OverviewTab>('collecties')
  const [viewMode, setViewMode] = useState<ViewMode>('per_kwaliteit')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [productType, setProductType] = useState<ProductType | 'alle'>('alle')
  const [expandedArtikel, setExpandedArtikel] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<ProductSortField>('artikelnr')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')

  const handleSort = (field: ProductSortField) => {
    if (field === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir(['verkoopprijs', 'voorraad', 'vrije_voorraad', 'aantal_rollen', 'totaal_oppervlak_m2'].includes(field) ? 'desc' : 'asc')
    }
    setPage(0)
  }

  // Forceer flat list bij artikelnr-zoekopdracht — kwaliteit-grouping kan niet matchen op artikelnr
  const looksLikeArtikelSearch = /^\s*\d{3,}/.test(search) || /^[A-Za-z]{3,4}\d/.test(search.trim())
  const effectiveViewMode: ViewMode = looksLikeArtikelSearch ? 'per_product' : viewMode

  const { data, isLoading } = useProducten({
    search,
    page,
    productType,
    sortBy,
    sortDir,
  })
  const producten = data?.producten ?? []
  const flatTotalCount = data?.totalCount ?? 0
  const showRollen = productType !== 'vast' && productType !== 'staaltje'

  // Voor de gegroepeerde view: tel producten op basis van de kwaliteiten-data
  // (zelfde bron als de view zelf), zodat de header niet vastloopt op de
  // 1000-cap van de search-query maar het echte totaal toont.
  const { data: kwaliteitenData = [] } = useQuery({
    queryKey: ['kwaliteiten-met-gewicht'],
    queryFn: fetchKwaliteitenMetGewicht,
  })

  const groupedCounts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = kwaliteitenData
      .filter((q) => q.aantal_producten > 0)
      .filter((q) => {
        if (!term) return true
        return `${q.code} ${q.omschrijving ?? ''} ${(q as import('@/lib/supabase/queries/kwaliteiten').KwaliteitMetGewicht).naam_afgeleid ?? ''}`.toLowerCase().includes(term)
      })
    return {
      kwaliteiten: matched.length,
      producten: matched.reduce((sum, q) => sum + q.aantal_producten, 0),
    }
  }, [kwaliteitenData, search])

  const headerDescription = effectiveViewMode === 'per_kwaliteit'
    ? `${groupedCounts.kwaliteiten} ${groupedCounts.kwaliteiten === 1 ? 'kwaliteit' : 'kwaliteiten'} · ${groupedCounts.producten} producten`
    : `${flatTotalCount} producten`

  const toggleExpand = (artikelnr: string) => {
    setExpandedArtikel(prev => prev === artikelnr ? null : artikelnr)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-0">
        <PageHeader
          title="Producten"
          description={headerDescription}
        />
        <Link
          to="/producten/nieuw"
          className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600"
        >
          + Nieuw product
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-slate-200 mb-6">
        <button
          onClick={() => setActiveTab('collecties')}
          className={cn(
            'flex items-center gap-2 pb-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'collecties'
              ? 'border-terracotta-500 text-terracotta-600'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          <LayoutGrid size={15} />
          Collecties
        </button>
        <button
          onClick={() => setActiveTab('uitwisselbaar')}
          className={cn(
            'flex items-center gap-2 pb-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'uitwisselbaar'
              ? 'border-terracotta-500 text-terracotta-600'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          <Link2 size={15} />
          Uitwisselbaar
        </button>
      </div>

      {activeTab === 'uitwisselbaar' ? (
        <UitwisselbaarTab />
      ) : (
      <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder={effectiveViewMode === 'per_kwaliteit' ? 'Zoek op kwaliteit-code of -naam...' : 'Zoek op artikelnr, karpi-code, zoeksleutel...'}
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        {/* View-mode toggle */}
        <div className="flex gap-1 bg-slate-100 rounded-[var(--radius-sm)] p-1">
          <button
            onClick={() => setViewMode('per_kwaliteit')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] transition-colors',
              effectiveViewMode === 'per_kwaliteit'
                ? 'bg-white text-slate-900 shadow-sm font-medium'
                : 'text-slate-500 hover:text-slate-700',
            )}
            title="Producten gegroepeerd per kwaliteit"
          >
            <Layers size={14} />
            Per kwaliteit
          </button>
          <button
            onClick={() => setViewMode('per_product')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] transition-colors',
              effectiveViewMode === 'per_product'
                ? 'bg-white text-slate-900 shadow-sm font-medium'
                : 'text-slate-500 hover:text-slate-700',
            )}
            title="Platte productenlijst"
          >
            <List size={14} />
            Per product
          </button>
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

      {effectiveViewMode === 'per_kwaliteit' ? (
        <KwaliteitenGroupedView search={search} productType={productType} />
      ) : (
        <FlatProductTable
          producten={producten}
          isLoading={isLoading}
          totalCount={flatTotalCount}
          page={page}
          setPage={setPage}
          sortBy={sortBy}
          sortDir={sortDir}
          handleSort={handleSort}
          showRollen={showRollen}
          expandedArtikel={expandedArtikel}
          toggleExpand={toggleExpand}
        />
      )}
      </>
      )}
    </>
  )
}

function FlatProductTable({ producten, isLoading, totalCount, page, setPage, sortBy, sortDir, handleSort, showRollen, expandedArtikel, toggleExpand }: {
  producten: import('@/lib/supabase/queries/producten').ProductRow[]
  isLoading: boolean
  totalCount: number
  page: number
  setPage: (n: number) => void
  sortBy: ProductSortField
  sortDir: SortDirection
  handleSort: (field: ProductSortField) => void
  showRollen: boolean
  expandedArtikel: string | null
  toggleExpand: (artikelnr: string) => void
}) {
  if (isLoading) {
    return <div className="text-slate-400">Producten laden...</div>
  }
  if (producten.length === 0) {
    return <div className="text-slate-400">Geen producten gevonden</div>
  }

  return (
    <>
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <SortHeader field="artikelnr" label="Artikelnr" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader field="karpi_code" label="Karpi-code" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader field="omschrijving" label="Omschrijving" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-left px-4 py-3 font-medium text-slate-600">Type</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Kwaliteit</th>
              <SortHeader field="locatie" label="Locatie" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              {showRollen && <SortHeader field="aantal_rollen" label="Rollen" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />}
              <SortHeader field="voorraad" label="Voorraad" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader field="vrije_voorraad" label="Vrij" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader field="verkoopprijs" label="Prijs" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {producten.map((p) => (
              <ProductRow
                key={p.artikelnr}
                p={p}
                expanded={expandedArtikel === p.artikelnr}
                onToggle={() => toggleExpand(p.artikelnr)}
                showRollen={showRollen}
                colSpan={COL_COUNT}
              />
            ))}
          </tbody>
        </table>
      </div>

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
