import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Search,
} from 'lucide-react'
import { useOpenRegelOverzicht } from '../hooks/use-inkooporders'
import { useLeveranciersOverzicht } from '../hooks/use-leveranciers'
import type { OpenRegelOverzichtRow } from '../queries/inkooporders'

type SortKey = 'eta' | 'leverancier' | 'order' | 'product'
type SortDir = 'asc' | 'desc'

function formatDatum(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function formatAantal(n: number): string {
  return n.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

function isoWeekLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const wk = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `wk ${wk}`
}

function EtaBadge({ regel }: { regel: OpenRegelOverzichtRow }) {
  const today = new Date().toISOString().slice(0, 10)
  const isAchterstallig = regel.verwacht_datum && regel.verwacht_datum < today
  const isDezeWeek = (() => {
    if (!regel.verwacht_datum) return false
    const d = new Date(regel.verwacht_datum)
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay() + 1)
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    return d >= startOfWeek && d <= endOfWeek
  })()

  if (!regel.verwacht_datum) {
    return <span className="text-slate-400">—</span>
  }

  return (
    <div>
      <span
        className={`text-sm font-medium ${
          isAchterstallig
            ? 'text-red-600'
            : isDezeWeek
            ? 'text-emerald-700'
            : 'text-slate-700'
        }`}
      >
        {formatDatum(regel.verwacht_datum)}
      </span>
      <div className="text-xs text-slate-400">
        {isoWeekLabel(regel.verwacht_datum)}
        {regel.eta_bijgewerkt_door && (
          <span className="ml-1.5">
            {regel.eta_bijgewerkt_door === 'leverancier' ? (
              <span className="text-blue-500" title="Bijgewerkt door leverancier">▲</span>
            ) : (
              <span className="text-slate-400" title="Bijgewerkt door Karpi">✎</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={12} className="text-slate-300" />
  return dir === 'asc' ? (
    <ArrowUp size={12} className="text-slate-600" />
  ) : (
    <ArrowDown size={12} className="text-slate-600" />
  )
}

export function InkoopRegelOverzichtTab() {
  const [leverancierId, setLeverancierId] = useState<number | 'alle'>('alle')
  const [zoek, setZoek] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('eta')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: regels = [], isLoading } = useOpenRegelOverzicht(leverancierId)
  const { data: leveranciers = [] } = useLeveranciersOverzicht()

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    setSortDir(d => d === 'asc' ? 'desc' : 'asc')
  }

  const filtered = useMemo(() => {
    if (!zoek.trim()) return regels
    const q = zoek.toLowerCase()
    return regels.filter(
      (r) =>
        r.inkooporder_nr.toLowerCase().includes(q) ||
        (r.leverancier_naam ?? '').toLowerCase().includes(q) ||
        (r.artikelnr ?? '').toLowerCase().includes(q) ||
        (r.karpi_code ?? '').toLowerCase().includes(q) ||
        (r.artikel_omschrijving ?? '').toLowerCase().includes(q) ||
        (r.product_omschrijving ?? '').toLowerCase().includes(q),
    )
  }, [regels, zoek])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'eta') {
        const da = a.verwacht_datum ?? '9999'
        const db = b.verwacht_datum ?? '9999'
        cmp = da < db ? -1 : da > db ? 1 : 0
      } else if (sortKey === 'leverancier') {
        cmp = (a.leverancier_naam ?? '').localeCompare(b.leverancier_naam ?? '', 'nl-NL', { sensitivity: 'base' })
      } else if (sortKey === 'order') {
        cmp = a.inkooporder_nr.localeCompare(b.inkooporder_nr)
      } else if (sortKey === 'product') {
        const pa = a.artikel_omschrijving ?? a.product_omschrijving ?? a.artikelnr ?? ''
        const pb = b.artikel_omschrijving ?? b.product_omschrijving ?? b.artikelnr ?? ''
        cmp = pa.localeCompare(pb, 'nl-NL', { sensitivity: 'base' })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  // Groepeer per leverancier voor subheaders als "Alle leveranciers" geselecteerd
  const showLeverancierKolom = leverancierId === 'alle'

  const achterstallig = regels.filter(r => r.verwacht_datum && r.verwacht_datum < new Date().toISOString().slice(0, 10)).length
  const geenEta = regels.filter(r => !r.verwacht_datum).length

  return (
    <div className="space-y-4">
      {/* Statistiek-balk */}
      {regels.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-slate-500">{regels.length} regels</span>
          {achterstallig > 0 && (
            <span className="text-red-600 font-medium">{achterstallig} achterstallig</span>
          )}
          {geenEta > 0 && (
            <span className="text-amber-600">{geenEta} zonder ETA</span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek product, order, leverancier…"
            className="w-full pl-9 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
          />
        </div>

        <select
          value={leverancierId}
          onChange={(e) => setLeverancierId(e.target.value === 'alle' ? 'alle' : Number(e.target.value))}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white"
        >
          <option value="alle">Alle leveranciers</option>
          {leveranciers.filter(l => l.actief).map((l) => (
            <option key={l.id} value={l.id}>
              {l.naam}
            </option>
          ))}
        </select>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Regels laden…</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Geen open regels gevonden</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                {showLeverancierKolom && (
                  <th className="px-4 py-3 text-left font-medium">
                    <button
                      onClick={() => toggleSort('leverancier')}
                      className="inline-flex items-center gap-1.5 hover:text-slate-900"
                    >
                      <Building2 size={13} />
                      Leverancier
                      <SortIcon active={sortKey === 'leverancier'} dir={sortDir} />
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium">
                  <button
                    onClick={() => toggleSort('order')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900"
                  >
                    Inkooporder
                    <SortIcon active={sortKey === 'order'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <button
                    onClick={() => toggleSort('product')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900"
                  >
                    Product
                    <SortIcon active={sortKey === 'product'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">Besteld</th>
                <th className="px-4 py-3 text-right font-medium">Geleverd</th>
                <th className="px-4 py-3 text-right font-medium">Te leveren</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button
                    onClick={() => toggleSort('eta')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-900"
                  >
                    ETA
                    <SortIcon active={sortKey === 'eta'} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const omschrijving =
                  r.artikel_omschrijving ?? r.product_omschrijving ?? r.artikelnr ?? `Regel ${r.regelnummer}`
                const unit = r.eenheid === 'stuks' ? 'st' : 'm'
                const today = new Date().toISOString().slice(0, 10)
                const isAchterstallig = r.verwacht_datum && r.verwacht_datum < today

                return (
                  <tr
                    key={r.regel_id}
                    className={`hover:bg-slate-50/60 transition-colors ${isAchterstallig ? 'bg-red-50/30' : ''}`}
                  >
                    {showLeverancierKolom && (
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {r.leverancier_naam ?? <span className="text-slate-400">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        to={`/inkoop/${r.inkooporder_id}`}
                        className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.inkooporder_nr}
                      </Link>
                      <div className="text-xs text-slate-400">Regel {r.regelnummer}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      <div className="text-slate-800 truncate" title={omschrijving}>
                        {omschrijving}
                      </div>
                      {r.karpi_code && (
                        <div className="text-xs text-slate-400 font-mono">{r.karpi_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                      {formatAantal(r.besteld_m)} {unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 whitespace-nowrap">
                      {formatAantal(r.geleverd_m)} {unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                      <span className={r.te_leveren_m > 0 ? 'text-slate-800' : 'text-slate-400'}>
                        {formatAantal(r.te_leveren_m)} {unit}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <EtaBadge regel={r} />
                      {r.leverancier_notitie && (
                        <div className="text-xs text-blue-600 italic mt-0.5 max-w-[160px] truncate" title={r.leverancier_notitie}>
                          "{r.leverancier_notitie}"
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Legenda */}
      <div className="flex gap-4 text-xs text-slate-400 pb-1">
        <span><span className="text-blue-500">▲</span> ETA bijgewerkt door leverancier</span>
        <span><span className="text-slate-400">✎</span> ETA bijgewerkt door Karpi</span>
        <span className="text-red-400">Rood = achterstallig</span>
        <span className="text-emerald-600">Groen = deze week</span>
      </div>
    </div>
  )
}
