import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, FileDown, X } from 'lucide-react'
import { useFacturen } from '../hooks/use-facturen'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { isFactuurCreditnota, getFactuurPdfSignedUrl, type FactuurListItem } from '../queries/facturen'
import { StatusBadge } from '@/components/ui/status-badge'

interface FactuurLijstProps {
  debiteurNr?: number
  compact?: boolean
  /** client-side filter — applied on top of the debiteurNr filter */
  items?: FactuurListItem[]
  /** Set met geselecteerde factuur-id's; aanwezig = checkbox-kolom tonen. */
  selectie?: Set<number>
  onToggle?: (id: number) => void
  onToggleAlles?: (zichtbareIds: number[], aan: boolean) => void
}

type SortKey = 'factuur_nr' | 'factuurdatum' | 'klant_naam' | 'totaal'
type SortDir = 'asc' | 'desc'

// Default = factuurdatum desc, tiebreak factuur_nr desc (zodat 0014 boven 0013
// staat bij gelijke datum). Komt overeen met de server-side .order(...) in
// fetchFacturen — beide kanten op hetzelfde patroon.
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = {
  key: 'factuurdatum',
  dir: 'desc',
}

export function FactuurLijst({
  debiteurNr,
  compact = false,
  items,
  selectie,
  onToggle,
  onToggleAlles,
}: FactuurLijstProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useFacturen(debiteurNr)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [pdfBezig, setPdfBezig] = useState<number | null>(null)

  async function downloadPdf(f: FactuurListItem) {
    if (!f.pdf_storage_path || pdfBezig === f.id) return
    setPdfBezig(f.id)
    try {
      const url = await getFactuurPdfSignedUrl(f.pdf_storage_path)
      const res = await fetch(url)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${f.factuur_nr}.pdf`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } finally {
      setPdfBezig(null)
    }
  }

  const facturen = items ?? data ?? []
  const showKlant = !debiteurNr
  const showSelectie = Boolean(selectie && onToggle)

  const gesorteerd = useMemo(() => {
    const lijst = [...facturen]
    const richting = sort.dir === 'asc' ? 1 : -1
    lijst.sort((a, b) => {
      const primair = vergelijk(a, b, sort.key) * richting
      if (primair !== 0) return primair
      // Tiebreak op factuur_nr (descending) — FACT-* vóór plain-nummers.
      const aF = a.factuur_nr.startsWith('FACT-')
      const bF = b.factuur_nr.startsWith('FACT-')
      if (aF !== bF) return aF ? -1 : 1
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

  const zichtbareIds = gesorteerd.map((f) => f.id)
  const allesGeselecteerd =
    showSelectie &&
    zichtbareIds.length > 0 &&
    zichtbareIds.every((id) => selectie!.has(id))
  const ietsGeselecteerd =
    showSelectie && !allesGeselecteerd && zichtbareIds.some((id) => selectie!.has(id))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            {showSelectie && (
              <th className="pb-3 pr-3 w-8">
                <input
                  type="checkbox"
                  checked={allesGeselecteerd}
                  ref={(el) => {
                    if (el) el.indeterminate = ietsGeselecteerd
                  }}
                  onChange={(e) => onToggleAlles?.(zichtbareIds, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
                  aria-label="Selecteer alle zichtbare facturen"
                />
              </th>
            )}
            <th className="pb-3 pr-4 font-medium text-slate-500">Type</th>
            <th className="pb-3 pr-4 font-medium text-slate-500">Status</th>
            <SortHeader label="Factuurnr" sortKey="factuur_nr" sort={sort} onClick={klikHeader} />
            <SortHeader label="Datum" sortKey="factuurdatum" sort={sort} onClick={klikHeader} />
            <th className="pb-3 pr-4 font-medium text-slate-500">Order</th>
            {showKlant && (
              <SortHeader label="Klant" sortKey="klant_naam" sort={sort} onClick={klikHeader} />
            )}
            <th className="pb-3 pr-4 font-medium text-slate-500">Verstuurd</th>
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
          {gesorteerd.map((f) => {
            const aan = showSelectie ? selectie!.has(f.id) : false
            return (
              <tr
                key={f.id}
                className={`hover:bg-slate-50 transition-colors cursor-pointer ${aan ? 'bg-terracotta-50/40' : ''}`}
                onClick={() => navigate(`/facturatie/${f.id}`)}
              >
                {showSelectie && (
                  <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={aan}
                      onChange={() => onToggle?.(f.id)}
                      className="h-4 w-4 rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
                      aria-label={`Selecteer ${f.factuur_nr}`}
                    />
                  </td>
                )}
                <td className="py-3 pr-4">
                  {isFactuurCreditnota(f) ? (
                    <span className="inline-flex items-center rounded-md bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                      Credit
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      Debet
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={f.status} type="factuur" />
                </td>
                <td className={`py-3 pr-4 font-mono text-xs text-slate-700 ${compact ? '' : 'py-3'}`}>
                  {f.factuur_nr}
                </td>
                <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">
                  {formatDate(f.factuurdatum)}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {f.orders.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
                      {f.orders.map((o, i) => (
                        <span key={o.id}>
                          <Link
                            to={`/orders/${o.id}`}
                            className="text-terracotta-500 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {o.nr}
                          </Link>
                          {i < f.orders.length - 1 && (
                            <span className="text-slate-300">,</span>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                {showKlant && (
                  <td className="py-3 pr-4 max-w-[200px] truncate">
                    {f.klant_naam ? (
                      <Link
                        to={`/klanten/${f.debiteur_nr}`}
                        className="text-terracotta-500 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {f.klant_naam}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                )}
                <td className="py-3 pr-4">
                  {f.verstuurd_op
                    ? <Check size={16} className="text-emerald-500" />
                    : <X size={16} className="text-red-400" />}
                </td>
                <td className={`py-3 pr-4 text-right font-medium whitespace-nowrap tabular-nums ${isFactuurCreditnota(f) ? 'text-red-600' : 'text-slate-700'}`}>
                  {isFactuurCreditnota(f) ? `− ${formatCurrency(Math.abs(f.totaal))}` : formatCurrency(f.totaal)}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/facturatie/${f.id}`}
                      className="text-xs text-terracotta-500 hover:underline whitespace-nowrap"
                    >
                      Bekijk
                    </Link>
                    {f.pdf_storage_path && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); downloadPdf(f) }}
                        disabled={pdfBezig === f.id}
                        title="Download PDF"
                        className="text-slate-400 hover:text-terracotta-500 disabled:opacity-40 transition-colors"
                      >
                        <FileDown size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
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
  if (key === 'klant_naam') return 'asc'
  return 'desc'
}

function vergelijk(a: FactuurListItem, b: FactuurListItem, key: SortKey): number {
  switch (key) {
    case 'factuur_nr': {
      // Oud-systeem nummers (puur cijfers, bv. 2026000187) staan alfabetisch
      // vóór FACT-* omdat '2' < 'F'. Ze zijn echter inhoudelijk nieuwer dan de
      // FACT-reeks. Oplossing: FACT-* altijd vóór plain-nummers plaatsen binnen
      // dezelfde sorteerrichting.
      const aIsFact = a.factuur_nr.startsWith('FACT-')
      const bIsFact = b.factuur_nr.startsWith('FACT-')
      if (aIsFact !== bIsFact) return aIsFact ? -1 : 1
      return a.factuur_nr.localeCompare(b.factuur_nr)
    }
    case 'factuurdatum':
      return a.factuurdatum.localeCompare(b.factuurdatum)
    case 'klant_naam':
      return (a.klant_naam ?? '').localeCompare(b.klant_naam ?? '', 'nl', {
        sensitivity: 'base',
      })
    case 'totaal':
      return a.totaal - b.totaal
  }
}
