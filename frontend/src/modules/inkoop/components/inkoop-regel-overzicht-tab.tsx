import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Check,
  Search,
} from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useOpenRegelOverzicht } from '../hooks/use-inkooporders'
import { useLeveranciersOverzicht } from '../hooks/use-leveranciers'
import { updateRegelEta } from '../queries/leveranciers'
import type { OpenRegelOverzichtRow } from '../queries/inkooporders'
import { isoWeekJaarVanIso } from '@/lib/utils/iso-week'

type SortKey = 'eta' | 'leverancier' | 'order' | 'product'
type SortDir = 'asc' | 'desc'

function formatAantal(n: number): string {
  return n.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}


function isoWeekLabel(iso: string | null): string {
  const w = isoWeekJaarVanIso(iso)
  return w ? `wk ${w.week}` : ''
}

function EtaInlineEdit({ regel }: { regel: OpenRegelOverzichtRow }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(regel.verwacht_datum ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().slice(0, 10)

  const isDirty = value !== (regel.verwacht_datum ?? '')

  const mutation = useMutation({
    mutationFn: () => updateRegelEta(regel.regel_id, value, regel.leverancier_id!, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inkooporders', 'regel-overzicht'] })
    },
  })

  const isAchterstallig = value && value < today
  const isDezeWeek = (() => {
    if (!value) return false
    const d = new Date(value)
    const now = new Date()
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay() + 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return d >= start && d <= end
  })()

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`text-sm border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-400 w-[140px] tabular-nums font-medium
          ${isAchterstallig ? 'text-red-600 border-red-200' : isDezeWeek ? 'text-emerald-700 border-emerald-200' : 'text-slate-700 border-slate-200'}
          ${isDirty ? 'bg-amber-50 border-amber-300' : 'bg-transparent'}`}
      />
      <div className="text-xs text-slate-400 pl-0.5">
        <span>{isoWeekLabel(value || null)}</span>
      </div>
      {isDirty && (
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !value}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap w-fit"
        >
          {mutation.isPending ? (
            <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin inline-block" />
          ) : (
            <Check size={11} />
          )}
          Opslaan
        </button>
      )}
      {mutation.isError && (
        <span className="text-xs text-red-500">Fout bij opslaan</span>
      )}
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

  const showLeverancierKolom = leverancierId === 'alle'
  const achterstallig = regels.filter(r => r.verwacht_datum && r.verwacht_datum < new Date().toISOString().slice(0, 10)).length
  const geenEta = regels.filter(r => !r.verwacht_datum).length

  return (
    <div className="space-y-4">
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
            <option key={l.id} value={l.id}>{l.naam}</option>
          ))}
        </select>
      </div>

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
                    <button onClick={() => toggleSort('leverancier')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                      <Building2 size={13} />
                      Leverancier
                      <SortIcon active={sortKey === 'leverancier'} dir={sortDir} />
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('order')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Inkooporder
                    <SortIcon active={sortKey === 'order'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('product')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Product
                    <SortIcon active={sortKey === 'product'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">Besteld</th>
                <th className="px-4 py-3 text-right font-medium">Geleverd</th>
                <th className="px-4 py-3 text-right font-medium">Te leveren</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('eta')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    ETA
                    <SortIcon active={sortKey === 'eta'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Gewijzigd</th>
                <th className="px-4 py-3 text-left font-medium">Opmerking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const omschrijving = r.artikel_omschrijving ?? r.product_omschrijving ?? r.artikelnr ?? `Regel ${r.regelnummer}`
                const unit = r.eenheid === 'stuks' ? 'st' : 'm'
                const isAchterstallig = r.verwacht_datum && r.verwacht_datum < new Date().toISOString().slice(0, 10)

                return (
                  <tr key={r.regel_id} className={`hover:bg-slate-50/60 transition-colors ${isAchterstallig ? 'bg-red-50/30' : ''}`}>
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
                      <div className="text-slate-800 truncate" title={omschrijving}>{omschrijving}</div>
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
                      {r.snijplan_gebruikte_lengte_cm > 0 && (
                        <div
                          className="text-xs text-orange-600 font-normal mt-0.5"
                          title="Aantal meter van deze (nog niet ontvangen) rol al toegewezen aan snijplanning (status 'Wacht op inkoop')"
                        >
                          {formatAantal(r.snijplan_gebruikte_lengte_cm / 100)} m gebruikt door snijplanning
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <EtaInlineEdit regel={r} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.eta_bijgewerkt_op ? (
                        <div>
                          <div className="text-sm text-slate-700">
                            {r.eta_bijgewerkt_op.slice(8, 10)}-{r.eta_bijgewerkt_op.slice(5, 7)}-{r.eta_bijgewerkt_op.slice(0, 4)}
                          </div>
                          <div className={`text-xs mt-0.5 font-medium ${r.eta_bijgewerkt_door === 'leverancier' ? 'text-blue-500' : 'text-slate-400'}`}>
                            {r.eta_bijgewerkt_door === 'leverancier'
                              ? (r.leverancier_naam ?? 'Leverancier')
                              : 'Karpi'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {r.leverancier_notitie ? (
                        <span className="text-sm text-blue-700 italic" title={r.leverancier_notitie}>
                          {r.leverancier_notitie}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-4 text-xs text-slate-400 pb-1">
        <span><span className="text-blue-500">▲</span> ETA bijgewerkt door leverancier</span>
        <span><span className="text-slate-400">✎</span> ETA bijgewerkt door Karpi</span>
        <span className="text-red-400">Rood = achterstallig</span>
        <span className="text-emerald-600">Groen = deze week</span>
      </div>
    </div>
  )
}
