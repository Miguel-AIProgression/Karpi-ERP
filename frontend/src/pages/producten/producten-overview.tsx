import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Link2, LayoutGrid, MapPin, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { formatCurrency, formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { useProducten, useUpdateProductType, useUpdateProductLocatie } from '@/hooks/use-producten'
import { useRollenVoorProduct } from '@/hooks/use-producten'
import { UitwisselbaarTab } from './uitwisselbaar-tab'
import type { ProductType, ProductRow as ProductRowData, ProductSortField, SortDirection } from '@/lib/supabase/queries/producten'

type OverviewTab = 'collecties' | 'uitwisselbaar'

const TYPE_OPTIONS: { value: ProductType | 'alle'; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'vast', label: 'Standaard maten' },
  { value: 'rol', label: 'Rollen' },
  { value: 'staaltje', label: 'Stalen' },
  { value: 'overig', label: 'Overig' },
]

const COL_COUNT = 10

const TYPE_LABELS: Record<ProductType, string> = {
  vast: 'Vaste maat',
  staaltje: 'Staaltje',
  rol: 'Rol',
  overig: 'Overig',
}

const TYPE_STYLES: Record<ProductType, string> = {
  vast: 'bg-blue-100 text-blue-700',
  staaltje: 'bg-purple-100 text-purple-700',
  rol: 'bg-amber-100 text-amber-700',
  overig: 'bg-slate-100 text-slate-500',
}

function ProductTypeBadge({ type }: { type: ProductType | null }) {
  if (!type) return null
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', TYPE_STYLES[type])}>
      {TYPE_LABELS[type]}
    </span>
  )
}

export { ProductTypeBadge }

function EditableProductType({ artikelnr, type }: { artikelnr: string; type: ProductType | null }) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mutation = useUpdateProductType()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setDropUp(spaceBelow < 180)
    }
    setOpen(!open)
  }

  const handleSelect = (newType: ProductType) => {
    if (newType !== type) {
      mutation.mutate({ artikelnr, productType: newType })
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="cursor-pointer hover:ring-2 hover:ring-slate-300 rounded-full transition-all"
        title="Klik om type te wijzigen"
      >
        <ProductTypeBadge type={type} />
      </button>
      {open && (
        <div className={cn(
          'fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[130px]',
        )} style={{
          left: ref.current ? ref.current.getBoundingClientRect().left : 0,
          top: dropUp
            ? (ref.current ? ref.current.getBoundingClientRect().top - 160 : 0)
            : (ref.current ? ref.current.getBoundingClientRect().bottom + 4 : 0),
        }}>
          {(['vast', 'staaltje', 'rol', 'overig'] as ProductType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleSelect(t)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2',
                t === type && 'font-medium bg-slate-50',
              )}
            >
              <span className={cn('w-2 h-2 rounded-full', TYPE_STYLES[t])} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EditableLocatie({ artikelnr, locatie }: { artikelnr: string; locatie: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(locatie ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const mutation = useUpdateProductLocatie()

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleSave = () => {
    const trimmed = value.trim()
    const newLocatie = trimmed || null
    if (newLocatie !== locatie) {
      mutation.mutate({ artikelnr, locatie: newLocatie })
    }
    setEditing(false)
  }

  const handleCancel = () => {
    setValue(locatie ?? '')
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') handleCancel()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="w-20 px-1.5 py-0.5 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-terracotta-400"
          placeholder="A.01.L"
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => { setValue(locatie ?? ''); setEditing(true) }}
      className="group flex items-center gap-1 cursor-pointer"
      title="Klik om locatie te wijzigen"
    >
      {locatie ? (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-mono">
          <MapPin size={11} />
          {locatie}
        </span>
      ) : (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
          <Pencil size={11} />
          Locatie
        </span>
      )}
    </button>
  )
}

function SortIcon({ field, sortBy, sortDir }: { field: ProductSortField; sortBy: ProductSortField; sortDir: SortDirection }) {
  if (field !== sortBy) return <ArrowUpDown size={14} className="text-slate-300" />
  return sortDir === 'asc'
    ? <ArrowUp size={14} className="text-terracotta-500" />
    : <ArrowDown size={14} className="text-terracotta-500" />
}

function SortHeader({ field, label, align = 'left', sortBy, sortDir, onSort }: {
  field: ProductSortField
  label: string
  align?: 'left' | 'right'
  sortBy: ProductSortField
  sortDir: SortDirection
  onSort: (field: ProductSortField) => void
}) {
  return (
    <th
      className={`text-${align} px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-900 transition-colors`}
      onClick={() => onSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <SortIcon field={field} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </th>
  )
}

function RollenExpandRow({ artikelnr }: { artikelnr: string }) {
  const { data: rollen, isLoading } = useRollenVoorProduct(artikelnr)

  if (isLoading) {
    return (
      <tr>
        <td colSpan={COL_COUNT} className="px-8 py-3 bg-amber-50/50 text-sm text-slate-400">
          Rollen laden...
        </td>
      </tr>
    )
  }

  if (!rollen || rollen.length === 0) {
    return (
      <tr>
        <td colSpan={COL_COUNT} className="px-8 py-3 bg-amber-50/50 text-sm text-slate-400">
          Geen rollen gevonden
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className="bg-amber-50/50">
        <td colSpan={COL_COUNT} className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-amber-200/50">
                <th className="text-left pl-12 pr-4 py-2 font-medium text-slate-500 text-xs">Rolnummer</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Lengte</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Breedte</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">m²</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">€/m²</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Waarde</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
              </tr>
            </thead>
            <tbody>
              {rollen.map((r) => (
                <tr key={r.id} className="border-b border-amber-100/50 hover:bg-amber-100/30">
                  <td className="pl-12 pr-4 py-2 font-mono text-xs">{r.rolnummer}</td>
                  <td className="px-4 py-2 text-right">{r.lengte_cm ? `${formatNumber(r.lengte_cm)} cm` : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.breedte_cm ? `${formatNumber(r.breedte_cm)} cm` : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.oppervlak_m2?.toFixed(2) ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(r.vvp_m2)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(r.waarde)}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs',
                      r.status === 'beschikbaar' && 'bg-emerald-100 text-emerald-700',
                      r.status === 'gereserveerd' && 'bg-amber-100 text-amber-700',
                      r.status === 'verkocht' && 'bg-slate-100 text-slate-500',
                      r.status === 'gesneden' && 'bg-blue-100 text-blue-700',
                      r.status === 'reststuk' && 'bg-purple-100 text-purple-700',
                    )}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  )
}

function ProductRow({ p, expanded, onToggle, showRollen }: { p: ProductRowData; expanded: boolean; onToggle: () => void; showRollen: boolean }) {
  const isRol = p.product_type === 'rol'
  const hasRollen = isRol && p.aantal_rollen > 0

  return (
    <>
      <tr className={cn('border-b border-slate-50 hover:bg-slate-50', expanded && 'bg-amber-50/30')}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {hasRollen ? (
              <button onClick={onToggle} className="text-slate-400 hover:text-slate-600 -ml-1 p-0.5">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-[22px]" />
            )}
            <Link to={`/producten/${p.artikelnr}`} className="text-terracotta-500 hover:underline font-mono text-xs">
              {p.artikelnr}
            </Link>
          </div>
        </td>
        <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.karpi_code ?? '—'}</td>
        <td className="px-4 py-3">{p.omschrijving}</td>
        <td className="px-4 py-3">
          <EditableProductType artikelnr={p.artikelnr} type={p.product_type} />
        </td>
        <td className="px-4 py-3">
          {p.zoeksleutel && (
            <span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-mono">{p.zoeksleutel}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <EditableLocatie artikelnr={p.artikelnr} locatie={p.locatie} />
        </td>
        {showRollen && (
          <td className="px-4 py-3 text-right">
            {hasRollen ? (
              <button onClick={onToggle} className="font-medium text-amber-700 hover:text-amber-900 hover:underline cursor-pointer">
                {p.aantal_rollen}
              </button>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        )}

        <td className="px-4 py-3 text-right">
          {isRol ? (
            <span title="m² beschikbaar">{p.totaal_oppervlak_m2 > 0 ? `${formatNumber(p.totaal_oppervlak_m2)} m²` : '—'}</span>
          ) : (
            formatNumber(p.voorraad)
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {isRol ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className={cn(
              'font-medium',
              p.vrije_voorraad <= 0 && 'text-rose-500',
              p.vrije_voorraad > 0 && p.vrije_voorraad <= 10 && 'text-amber-500',
              p.vrije_voorraad > 10 && 'text-emerald-600',
            )}>
              {formatNumber(p.vrije_voorraad)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right">{formatCurrency(p.verkoopprijs)}</td>
      </tr>
      {expanded && <RollenExpandRow artikelnr={p.artikelnr} />}
    </>
  )
}

export function ProductenOverviewPage() {
  const [activeTab, setActiveTab] = useState<OverviewTab>('collecties')
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

  const { data, isLoading } = useProducten({ search, page, productType, sortBy, sortDir })
  const producten = data?.producten ?? []
  const totalCount = data?.totalCount ?? 0
  const showRollen = productType !== 'vast' && productType !== 'staaltje'

  const toggleExpand = (artikelnr: string) => {
    setExpandedArtikel(prev => prev === artikelnr ? null : artikelnr)
  }

  return (
    <>
      <PageHeader
        title="Producten"
        description={`${totalCount} producten`}
      />

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
                />
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
      )}
    </>
  )
}
