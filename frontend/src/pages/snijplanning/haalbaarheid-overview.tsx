import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/formatters'
import { useSnijHaalbaarheid } from '@/modules/snijplanning'
import type { HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { HAALBAARHEID_STATUS_STYLE } from '@/lib/orders/haalbaarheid-status-badge'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'

type SortKey = 'status' | 'marge' | 'leverdatum' | 'klant'
type SortDir = 'asc' | 'desc'

const STATUS_VOLGORDE: Record<HaalbaarheidStatus, number> = { rood: 0, oranje: 1, groen: 2 }

/** Week-orders tonen de vertraging in weken (afgerond), tenzij dat naar 0 afrondt
 *  (een paar dagen te laat op een week-order) — dan toch in dagen, om geen
 *  "+0 weken" te tonen terwijl er wel degelijk vertraging is. */
function formatVertraging(dagen: number, isWeek: boolean): string {
  if (isWeek) {
    const weken = Math.round(dagen / 7)
    if (weken >= 1) return `+${weken} ${weken === 1 ? 'week' : 'weken'} later`
  }
  return `+${dagen} ${dagen === 1 ? 'dag' : 'dagen'} later`
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={12} className="text-slate-300" />
  return dir === 'asc' ? <ArrowUp size={12} className="text-slate-600" /> : <ArrowDown size={12} className="text-slate-600" />
}

export function HaalbaarheidOverviewPage() {
  const [zoek, setZoek] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { perOrder, isLoading } = useSnijHaalbaarheid()
  const orderRijen = useMemo(() => Array.from(perOrder.values()), [perOrder])

  const filtered = useMemo(() => {
    if (!zoek.trim()) return orderRijen
    const q = zoek.toLowerCase()
    return orderRijen.filter(
      (r) =>
        r.orderNr.toLowerCase().includes(q) ||
        r.klantNaam.toLowerCase().includes(q) ||
        r.stukken.some(
          (s) =>
            (s.kwaliteit_code ?? '').toLowerCase().includes(q) ||
            (s.kleur_code ?? '').toLowerCase().includes(q),
        ),
    )
  }, [orderRijen, zoek])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'status') {
        cmp = STATUS_VOLGORDE[a.haalbaarheidStatus] - STATUS_VOLGORDE[b.haalbaarheidStatus]
        if (cmp === 0) cmp = a.margeWerkdagen - b.margeWerkdagen
      } else if (sortKey === 'marge') {
        cmp = a.margeWerkdagen - b.margeWerkdagen
      } else if (sortKey === 'leverdatum') {
        cmp = (a.afleverdatum ?? '').localeCompare(b.afleverdatum ?? '')
      } else if (sortKey === 'klant') {
        cmp = a.klantNaam.localeCompare(b.klantNaam, 'nl-NL', { sensitivity: 'base' })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const aantalRood = orderRijen.filter((r) => r.haalbaarheidStatus === 'rood').length
  const aantalOranje = orderRijen.filter((r) => r.haalbaarheidStatus === 'oranje').length
  const aantalGroen = orderRijen.filter((r) => r.haalbaarheidStatus === 'groen').length

  return (
    <>
      <PageHeader
        title="Haalbaarheid maatwerk"
        description={`${orderRijen.length} maatwerk-orders nog te produceren — welke halen hun gevraagde deadline?`}
      />

      <div className="flex gap-4 text-sm mb-4">
        <span className="flex items-center gap-1.5 text-red-700 font-medium">
          <AlertTriangle size={14} /> {aantalRood} niet haalbaar
        </span>
        <span className="text-amber-700 font-medium">{aantalOranje} risico</span>
        <span className="text-emerald-700">{aantalGroen} oké</span>
      </div>

      <div className="relative w-80 mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek op order, klant, kwaliteit, kleur..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Laden...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Geen maatwerk-orders gevonden</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('klant')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Klant <SortIcon active={sortKey === 'klant'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">Kwaliteit · Kleur</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('leverdatum')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Leverdatum <SortIcon active={sortKey === 'leverdatum'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">Stukken</th>
                <th className="px-4 py-3 text-left font-medium">Geplande snijdatum</th>
                <th className="px-4 py-3 text-left font-medium">Verwachte verzending</th>
                <th className="px-4 py-3 text-right font-medium">
                  <button onClick={() => toggleSort('marge')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Marge <SortIcon active={sortKey === 'marge'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Haalbaarheid <SortIcon active={sortKey === 'status'} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const badge = HAALBAARHEID_STATUS_STYLE[r.haalbaarheidStatus]
                const isWeek = r.leverType === 'week'
                const verzendweek = isWeek ? verzendWeekVoor(r.afleverdatum) : null
                return (
                  <tr key={r.orderId} className={cn('hover:bg-slate-50/60', r.haalbaarheidStatus === 'rood' && 'bg-red-50/30')}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link to={`/orders/${r.orderId}`} className="font-medium text-terracotta-600 hover:underline">
                        {r.orderNr}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.klantNaam}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.kwaliteitKleurLabel}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isWeek && verzendweek ? (
                        <span>wk {verzendweek.week}/{verzendweek.jaar}</span>
                      ) : (
                        <span>{formatDate(r.afleverdatum)}</span>
                      )}
                      <div className="text-xs text-slate-400">{isWeek ? 'week-order' : 'dag-order'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {r.aantalGepland}/{r.aantalStukken} gepland
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {r.geplandeDatum ? (
                        formatDate(r.geplandeDatum)
                      ) : (
                        <span className="text-slate-400">Niet gepland</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.verwachteVerzendDatum ? (
                        <>
                          {isWeek ? (() => {
                            const verwachteWeek = verzendWeekVoor(r.verwachteVerzendDatum)
                            return verwachteWeek
                              ? <span className="text-slate-700">wk {verwachteWeek.week}/{verwachteWeek.jaar}</span>
                              : <span className="text-slate-700">{formatDate(r.verwachteVerzendDatum)}</span>
                          })() : (
                            <span className="text-slate-700">{formatDate(r.verwachteVerzendDatum)}</span>
                          )}
                          {r.vertragingDagen != null && (
                            r.vertragingDagen > 0 ? (
                              <div className="text-xs text-rose-600">{formatVertraging(r.vertragingDagen, isWeek)}</div>
                            ) : (
                              <div className="text-xs text-emerald-600">op tijd</div>
                            )
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      {r.margeWerkdagen} {r.margeWerkdagen === 1 ? 'werkdag' : 'werkdagen'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', badge.bg, badge.text)}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
