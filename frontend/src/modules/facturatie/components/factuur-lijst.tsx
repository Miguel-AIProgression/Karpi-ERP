import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useFacturen } from '../hooks/use-facturen'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import type { FactuurListItem } from '../queries/facturen'

interface FactuurLijstProps {
  debiteurNr?: number
  compact?: boolean
  /** client-side filter — applied on top of the debiteurNr filter */
  items?: FactuurListItem[]
}

type SortKey = 'factuur_nr' | 'factuurdatum' | 'klant_naam' | 'status' | 'totaal'
type SortDir = 'asc' | 'desc'

// Default = factuurdatum desc, tiebreak factuur_nr desc (zodat 0014 boven 0013
// staat bij gelijke datum). Komt overeen met de server-side .order(...) in
// fetchFacturen — beide kanten op hetzelfde patroon.
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = {
  key: 'factuurdatum',
  dir: 'desc',
}

export function FactuurLijst({ debiteurNr, compact = false, items }: FactuurLijstProps) {
  const { data, isLoading } = useFacturen(debiteurNr)
  const [sort, setSort] = useState(DEFAULT_SORT)

  const facturen = items ?? data ?? []
  const showKlant = !debiteurNr

  const gesorteerd = useMemo(() => {
    const lijst = [...facturen]
    const richting = sort.dir === 'asc' ? 1 : -1
    lijst.sort((a, b) => {
      const primair = vergelijk(a, b, sort.key) * richting
      if (primair !== 0) return primair
      // Tiebreak op factuur_nr (descending) zodat de volgorde stabiel én
      // logisch is bij gelijke datums/statussen/totaal.
      return b.factuur_nr.localeCompare(a.factuur_nr)
    })
    return lijst
  }, [facturen, sort])

  if (isLoading) {
    return <p className="text-sm text-slate-400 py-6 text-center">Laden…</p>
  }

  if (gesorteerd.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">Geen facturen</p>
  }

  function klikHeader(key: SortKey) {
    setSort((huidig) =>
      huidig.key === key
        ? { key, dir: huidig.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: standaardRichting(key) },
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <SortHeader label="Factuurnr" sortKey="factuur_nr" sort={sort} onClick={klikHeader} />
            <SortHeader label="Datum" sortKey="factuurdatum" sort={sort} onClick={klikHeader} />
            {showKlant && (
              <SortHeader label="Klant" sortKey="klant_naam" sort={sort} onClick={klikHeader} />
            )}
            <SortHeader label="Status" sortKey="status" sort={sort} onClick={klikHeader} />
            <SortHeader
              label="Totaal"
              sortKey="totaal"
              sort={sort}
              onClick={klikHeader}
              alignRight
            />
            <th className="pb-3 font-medium text-slate-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {gesorteerd.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50 transition-colors">
              <td className={`py-3 pr-4 font-mono text-xs text-slate-700 ${compact ? '' : 'py-3'}`}>
                {f.factuur_nr}
              </td>
              <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">
                {formatDate(f.factuurdatum)}
              </td>
              {showKlant && (
                <td className="py-3 pr-4 text-slate-700 max-w-[200px] truncate">
                  {f.klant_naam ?? '—'}
                </td>
              )}
              <td className="py-3 pr-4">
                <StatusBadge status={f.status} type="factuur" />
              </td>
              <td className="py-3 pr-4 text-right font-medium text-slate-700 whitespace-nowrap">
                {formatCurrency(f.totaal)}
              </td>
              <td className="py-3">
                <Link
                  to={`/facturatie/${f.id}`}
                  className="text-xs text-terracotta-500 hover:underline whitespace-nowrap"
                >
                  Bekijk
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface SortHeaderProps {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: SortDir }
  onClick: (key: SortKey) => void
  alignRight?: boolean
}

function SortHeader({ label, sortKey, sort, onClick, alignRight }: SortHeaderProps) {
  const actief = sort.key === sortKey
  const Icon = !actief ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`pb-3 pr-4 font-medium text-slate-500 ${alignRight ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-700 transition-colors ${
          actief ? 'text-slate-700' : ''
        }`}
      >
        <span>{label}</span>
        <Icon size={12} className={actief ? 'opacity-100' : 'opacity-40'} />
      </button>
    </th>
  )
}

function standaardRichting(key: SortKey): SortDir {
  // Numerieke en datum-velden beginnen aflopend (recent/groot eerst).
  // Tekst-velden beginnen oplopend (A-Z).
  if (key === 'klant_naam' || key === 'status') return 'asc'
  return 'desc'
}

function vergelijk(a: FactuurListItem, b: FactuurListItem, key: SortKey): number {
  switch (key) {
    case 'factuur_nr':
      return a.factuur_nr.localeCompare(b.factuur_nr)
    case 'factuurdatum':
      return a.factuurdatum.localeCompare(b.factuurdatum)
    case 'klant_naam':
      return (a.klant_naam ?? '').localeCompare(b.klant_naam ?? '', 'nl', {
        sensitivity: 'base',
      })
    case 'status':
      return a.status.localeCompare(b.status)
    case 'totaal':
      return a.totaal - b.totaal
  }
}
