import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/formatters'
import { useMaatwerkHaalbaarheid, useVormSnijtijden, useMoeilijkeKwaliteiten } from '@/modules/snijplanning'
import type { MaatwerkHaalbaarheidRow } from '@/modules/snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { useQuery } from '@tanstack/react-query'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { bepaalSnijDeadline, bepaalHaalbaarheidStatus, type HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { berekenAgenda, isoDatum, werkdagenTussen } from '@/lib/utils/bereken-agenda'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import { leverdatumVoorSnijDatum } from '@/lib/orders/levertijd-match'

type SortKey = 'status' | 'marge' | 'leverdatum' | 'klant'
type SortDir = 'asc' | 'desc'

const STATUS_VOLGORDE: Record<HaalbaarheidStatus, number> = { rood: 0, oranje: 1, groen: 2 }

const STATUS_BADGE: Record<HaalbaarheidStatus, { bg: string; text: string; label: string }> = {
  rood: { bg: 'bg-red-100', text: 'text-red-700', label: 'Niet haalbaar' },
  oranje: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Risico' },
  groen: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Oké' },
}

interface HaalbaarheidsRij extends MaatwerkHaalbaarheidRow {
  snijDeadline: string
  /** ISO-datum, of null als dit stuk nog geen rol heeft (niet gepland). */
  geplandeSnijDatum: string | null
  margeWerkdagen: number
  haalbaarheidStatus: HaalbaarheidStatus
  inkoopInfo?: { inkooporder_nr: string; verwacht_datum: string | null }
}

interface OrderRij {
  orderId: number
  orderNr: string
  klantNaam: string
  afleverdatum: string | null
  leverType: 'week' | 'datum'
  kwaliteitKleurLabel: string
  aantalStukken: number
  aantalGepland: number
  /** Laatste (meest kritieke) geplande snijdatum onder de al-geplande stukken. NULL = geen enkel stuk gepland. */
  geplandeDatum: string | null
  margeWerkdagen: number
  haalbaarheidStatus: HaalbaarheidStatus
  /**
   * Realistische verzenddatum = geplande snijdatum + buffer (confectie + klaarleggen) —
   * alleen gevuld wanneer ALLE stukken van de order al een rol hebben: bij een
   * deels geplande order zou de projectie te optimistisch zijn (de nog niet
   * geplande stukken kunnen de werkelijke datum nog verder naar achteren duwen).
   */
  verwachteVerzendDatum: string | null
  /** Calendar-dagen verschil tussen verwachteVerzendDatum en de gevraagde afleverdatum. Positief = later dan gevraagd. */
  vertragingDagen: number | null
  stukken: HaalbaarheidsRij[]
}

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

  const { data: haalbaarheid, isLoading } = useMaatwerkHaalbaarheid()
  const { data: planningConfig } = usePlanningConfig()
  const { data: werktijden } = useQuery({ queryKey: ['werkagenda-config'], queryFn: fetchWerkagendaConfig })
  const { data: vormTarieven } = useVormSnijtijden()
  const { data: moeilijkeKwaliteiten } = useMoeilijkeKwaliteiten()

  // Eén globale agenda over ALLE al-geplande stukken (alle kwaliteit/kleur-groepen
  // samen, ongebonden door een horizon) — exact de wachtrij zoals de snijder hem
  // doorwerkt. `berekenAgenda` plant vanaf "nu", wat vanzelf op de eerstvolgende
  // werkdag landt. Levert per rol een echte eind-datum: de kern van "wanneer wordt
  // dit nou echt gesneden", die nergens als los veld in de data bestaat.
  const rolEindMap = useMemo(() => {
    if (!haalbaarheid || !planningConfig || !werktijden || !vormTarieven || !moeilijkeKwaliteiten) return new Map<number, Date>()
    const blokken = berekenAgenda(haalbaarheid.rows, werktijden, planningConfig, vormTarieven, moeilijkeKwaliteiten)
    return new Map(blokken.map((b) => [b.rolId, b.eind]))
  }, [haalbaarheid, planningConfig, werktijden, vormTarieven, moeilijkeKwaliteiten])

  const rijen = useMemo<HaalbaarheidsRij[]>(() => {
    if (!haalbaarheid || !planningConfig || !werktijden) return []
    const vandaag = isoDatum(new Date())
    return haalbaarheid.rows
      .filter((r) => r.afleverdatum != null)
      .map((r) => {
        const snijDeadline = bepaalSnijDeadline(r.afleverdatum!, r.lever_type ?? 'week', planningConfig, werktijden)
        const eind = r.rol_id != null ? rolEindMap.get(r.rol_id) ?? null : null
        const geplandeSnijDatum = eind ? isoDatum(eind) : null
        // Geen rol → er is geen agenda-positie, dus terugvallen op de letterlijke
        // datum van vandaag (ongewijzigd Fase-1-gedrag voor niet-geplande stukken).
        const referentieDatum = geplandeSnijDatum ?? vandaag
        const margeWerkdagen = werkdagenTussen(referentieDatum, snijDeadline, werktijden)
        const status = bepaalHaalbaarheidStatus(snijDeadline, referentieDatum, werktijden)
        const inkoopInfo = r.verwacht_inkooporder_regel_id != null
          ? haalbaarheid.inkoopInfo.get(r.verwacht_inkooporder_regel_id)
          : undefined
        return { ...r, snijDeadline, geplandeSnijDatum, margeWerkdagen, haalbaarheidStatus: status, inkoopInfo }
      })
  }, [haalbaarheid, planningConfig, werktijden, rolEindMap])

  // Groepeer per order — het gevraagde overzicht is "halen we de deadline volgens
  // order", niet per los stuk. Een order met meerdere maatwerk-regels toont het
  // slechtste oordeel onder zijn stukken (rood > oranje > groen) en de laatste
  // (meest kritieke) geplande datum.
  const orderRijen = useMemo<OrderRij[]>(() => {
    if (!planningConfig || !werktijden) return []
    const groepen = new Map<number, HaalbaarheidsRij[]>()
    for (const r of rijen) {
      const lijst = groepen.get(r.order_id) ?? []
      lijst.push(r)
      groepen.set(r.order_id, lijst)
    }
    const result: OrderRij[] = []
    for (const [orderId, stukken] of groepen) {
      const eerste = stukken[0]
      const leverType = eerste.lever_type ?? 'week'
      const aantalGepland = stukken.filter((s) => s.rol_id != null).length
      const geplandeDatums = stukken
        .map((s) => s.geplandeSnijDatum)
        .filter((d): d is string => d != null)
      const geplandeDatum = geplandeDatums.length > 0
        ? geplandeDatums.reduce((a, b) => (a > b ? a : b))
        : null
      const status = stukken.reduce<HaalbaarheidStatus>(
        (worst, s) => (STATUS_VOLGORDE[s.haalbaarheidStatus] < STATUS_VOLGORDE[worst] ? s.haalbaarheidStatus : worst),
        'groen',
      )
      const margeWerkdagen = Math.min(...stukken.map((s) => s.margeWerkdagen))
      const combinaties = Array.from(
        new Set(stukken.map((s) => `${s.kwaliteit_code ?? '—'} · ${s.kleur_code ?? '—'}`)),
      )

      // Realistische verzenddatum: alleen geprojecteerd als ALLE stukken al een
      // rol hebben — bij een deels geplande order zouden de nog te plannen
      // stukken de werkelijke datum nog verder naar achteren kunnen duwen, dus
      // zou de projectie hier valse precisie suggereren.
      const volledigGepland = aantalGepland === stukken.length && geplandeDatum != null
      const bufferDagen = leverType === 'datum'
        ? planningConfig.dag_order_snij_buffer_werkdagen
        : planningConfig.logistieke_buffer_dagen
      const verwachteVerzendDatum = volledigGepland
        ? leverdatumVoorSnijDatum(geplandeDatum!, bufferDagen, werktijden)
        : null
      let vertragingDagen: number | null = null
      if (verwachteVerzendDatum && eerste.afleverdatum) {
        const verwacht = new Date(`${verwachteVerzendDatum}T00:00:00Z`).getTime()
        const gevraagd = new Date(`${eerste.afleverdatum}T00:00:00Z`).getTime()
        vertragingDagen = Math.round((verwacht - gevraagd) / 86_400_000)
      }

      result.push({
        orderId,
        orderNr: eerste.order_nr,
        klantNaam: eerste.klant_naam,
        afleverdatum: eerste.afleverdatum,
        leverType,
        kwaliteitKleurLabel: combinaties.length > 1 ? `${combinaties[0]} +${combinaties.length - 1}` : combinaties[0],
        aantalStukken: stukken.length,
        aantalGepland,
        geplandeDatum,
        margeWerkdagen,
        haalbaarheidStatus: status,
        verwachteVerzendDatum,
        vertragingDagen,
        stukken,
      })
    }
    return result
  }, [rijen, planningConfig, werktijden])

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
                const badge = STATUS_BADGE[r.haalbaarheidStatus]
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
