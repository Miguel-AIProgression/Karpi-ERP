import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { fetchBackorderPerArtikl, type BackorderArtikel } from '@/lib/supabase/queries/producten'

type SortCol = 'totaal_backorder' | 'totaal_te_leveren' | 'artikelnr' | 'kwaliteit_code' | 'vrije_voorraad' | 'besteld_inkoop' | 'aantal_orders'

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: 'asc' | 'desc' }) {
  if (col !== sortCol) return <ArrowUpDown size={13} className="text-slate-300" />
  return sortDir === 'asc'
    ? <ArrowUp size={13} className="text-terracotta-500" />
    : <ArrowDown size={13} className="text-terracotta-500" />
}

function Th({ label, col, sortCol, sortDir, onSort, align = 'left' }: {
  label: string
  col: SortCol
  sortCol: SortCol
  sortDir: 'asc' | 'desc'
  onSort: (c: SortCol) => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2.5 text-xs font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
      </span>
    </th>
  )
}

export function BackorderTab() {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('totaal_backorder')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data = [], isLoading } = useQuery({
    queryKey: ['backorder-per-artikel'],
    queryFn: fetchBackorderPerArtikl,
    staleTime: 60_000,
  })

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'artikelnr' || col === 'kwaliteit_code' ? 'asc' : 'desc')
    }
  }

  const zoekterm = search.toLowerCase()
  const gefilterd = data.filter(r =>
    !zoekterm ||
    (r.artikelnr ?? '').toLowerCase().includes(zoekterm) ||
    (r.karpi_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.kwaliteit_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.omschrijving ?? '').toLowerCase().includes(zoekterm) ||
    (r.kleur_code ?? '').toLowerCase().includes(zoekterm)
  )

  const gesorteerd = [...gefilterd].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    const va = a[sortCol] ?? 0
    const vb = b[sortCol] ?? 0
    if (typeof va === 'string' && typeof vb === 'string') return mul * va.localeCompare(vb)
    return mul * ((va as number) - (vb as number))
  })

  const totaalBackorder = data.reduce((s, r) => s + r.totaal_backorder, 0)
  const aantalArtikelen = data.length

  return (
    <div>
      {/* Samenvatting */}
      <div className="flex items-center gap-6 mb-4">
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5 text-center min-w-[120px]">
          <div className="text-2xl font-bold text-rose-700">{totaalBackorder.toLocaleString('nl-NL')}</div>
          <div className="text-xs text-rose-500 mt-0.5">stuks backorder</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-center min-w-[120px]">
          <div className="text-2xl font-bold text-slate-700">{aantalArtikelen}</div>
          <div className="text-xs text-slate-500 mt-0.5">afmetingen</div>
        </div>
        <div className="relative w-72 ml-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op artikel, code, kleur..."
            className="w-full pl-9 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th label="Artikel" col="artikelnr" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <Th label="Kwaliteit" col="kwaliteit_code" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2.5 text-xs font-medium text-slate-500 text-left">Afmeting</th>
              <Th label="Backorder" col="totaal_backorder" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <Th label="Te leveren" col="totaal_te_leveren" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <Th label="Orders" col="aantal_orders" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <Th label="Vrij voorraad" col="vrije_voorraad" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <Th label="Besteld inkoop" col="besteld_inkoop" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">Laden…</td>
              </tr>
            ) : gesorteerd.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                  {search ? 'Geen resultaten' : 'Geen openstaande backorders'}
                </td>
              </tr>
            ) : gesorteerd.map((r) => (
              <BackorderRij key={r.artikelnr} rij={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BackorderRij({ rij: r }: { rij: BackorderArtikel }) {
  const dekking = r.vrije_voorraad + r.besteld_inkoop
  const volledigGedekt = dekking >= r.totaal_backorder

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-3 py-2.5">
        <Link
          to={`/producten/${r.artikelnr}`}
          className="font-mono text-xs text-terracotta-600 hover:underline"
        >
          {r.karpi_code ?? r.artikelnr}
        </Link>
        {r.omschrijving && (
          <div className="text-xs text-slate-500 mt-0.5 max-w-[220px] truncate">{r.omschrijving}</div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs text-slate-700">{r.kwaliteit_code ?? '—'}</span>
        {r.kleur_code && (
          <span className="ml-1.5 text-xs text-slate-400">{r.kleur_code}</span>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
        {formatAfmeting(r.lengte_cm, r.breedte_cm)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="font-semibold text-rose-600">{r.totaal_backorder}</span>
      </td>
      <td className="px-3 py-2.5 text-right text-slate-600 text-xs">{r.totaal_te_leveren}</td>
      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{r.aantal_orders}</td>
      <td className="px-3 py-2.5 text-right">
        <span className={`text-xs font-medium ${r.vrije_voorraad > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
          {r.vrije_voorraad}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span
          className={`text-xs font-medium ${volledigGedekt ? 'text-emerald-600' : r.besteld_inkoop > 0 ? 'text-amber-600' : 'text-slate-400'}`}
          title={volledigGedekt ? 'Volledig gedekt door voorraad + inkoop' : r.besteld_inkoop > 0 ? 'Deels gedekt' : 'Geen inkoop uitstaan'}
        >
          {r.besteld_inkoop}
        </span>
      </td>
    </tr>
  )
}

function formatAfmeting(lengte: number | null, breedte: number | null): string {
  if (!lengte && !breedte) return '—'
  if (lengte && breedte) return `${lengte}×${breedte}`
  return String(lengte ?? breedte)
}
