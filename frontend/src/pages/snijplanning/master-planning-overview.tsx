import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, PackageX, List, Calendar, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/formatters'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { TE_SNIJDEN } from '@/lib/utils/snijplan-status'
import { useMasterPlanning, useVormSnijtijden, useMoeilijkeKwaliteiten } from '@/modules/snijplanning'
import type { MasterPlanningRow } from '@/modules/snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { useQuery } from '@tanstack/react-query'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { berekenHaalbaarheid, type HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { berekenAgenda, isoDatum, type RolBlok } from '@/lib/utils/bereken-agenda'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import { leverdatumVoorSnijDatum } from '@/lib/orders/levertijd-match'
import { bepaalMaatwerkFase, MAATWERK_FASE_PRESENTATIE, type MaatwerkFase } from '@/lib/orders/maatwerk-productie'
import { MateriaaltekortModal } from '@/components/snijplanning/materiaaltekort-modal'
import { isAchterstalligeEta } from '@/modules/inkoop/lib/inkoop-eta'

type SortKey = 'kwaliteit' | 'snijdatum' | 'leverdatum' | 'klant' | 'status'
type SortDir = 'asc' | 'desc'
type RijStatus = HaalbaarheidStatus | 'materiaaltekort'
type ViewMode = 'tabel' | 'per_dag'

const DAG_LABELS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']

function fmtTijd(d: Date): string {
  return d.toTimeString().slice(0, 5)
}
function fmtDagHeader(d: Date): string {
  return `${DAG_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

const TERMINALE_FASE_STATUSSEN = new Set(['Gesneden', 'In confectie', 'Gereed', 'Ingepakt'])

const STATUS_VOLGORDE: Record<RijStatus, number> = { rood: 0, materiaaltekort: 0, oranje: 1, groen: 2 }

const STATUS_BADGE: Record<RijStatus, { bg: string; text: string; label: string }> = {
  rood: { bg: 'bg-red-100', text: 'text-red-700', label: 'Te laat' },
  oranje: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Risico' },
  groen: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Op schema' },
  materiaaltekort: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Materiaaltekort' },
}

interface IngedeeldeRol {
  type: 'rol' | 'inkoop' | 'tekort'
  label: string
  /** Inkoop wacht op een ETA die al verstreken is — koppeling blijft staan (de
   *  inkoop komt alsnog), maar de datum klopt niet meer en moet bijgewerkt worden. */
  achterstallig?: boolean
}

export interface MasterPlanningRij extends MasterPlanningRow {
  snijDatum: string | null
  ingedeeldeRol: IngedeeldeRol
  statusKolom: RijStatus | null
  actueleFase: MaatwerkFase
  verwachteVerzendDatum: string | null
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={12} className="text-slate-300" />
  return dir === 'asc' ? <ArrowUp size={12} className="text-slate-600" /> : <ArrowDown size={12} className="text-slate-600" />
}

function VerzendweekCel({ datum, leverType }: { datum: string | null; leverType: 'week' | 'datum' }) {
  if (!datum) return <span className="text-slate-400">—</span>
  if (leverType === 'datum') return <span>{formatDate(datum)}</span>
  const w = verzendWeekVoor(datum)
  return w ? <span>wk {w.week}/{w.jaar}</span> : <span>{formatDate(datum)}</span>
}

/** Dag-voor-dag doorloop van de Gepland/Snijden-wachtrij — maakt het effect
 *  van "start produceren vanaf" direct zichtbaar (i.p.v. één kolom in een
 *  kwaliteit-gesorteerde tabel) en toont in één blik t/m welke dag alles
 *  klaar is. Zelfde dag-groeperingspatroon als de bestaande Agenda-tab
 *  (agenda-weergave.tsx), hier uitgebreid met de onderliggende orders per rol. */
function PerDagWeergave({ blokken }: { blokken: RolBlok<MasterPlanningRow>[] }) {
  const perDag = useMemo(() => {
    const map = new Map<string, RolBlok<MasterPlanningRow>[]>()
    for (const b of blokken) {
      const key = isoDatum(b.start)
      const lijst = map.get(key) ?? []
      lijst.push(b)
      map.set(key, lijst)
    }
    return Array.from(map.entries())
  }, [blokken])

  if (perDag.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Niets ingepland binnen deze simulatie
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {perDag.map(([iso, rollen]) => {
        const datum = new Date(`${iso}T00:00:00`)
        const totMin = rollen.reduce((s, b) => s + b.duurMinuten, 0)
        const totStukken = rollen.reduce((s, b) => s + b.stukken.length, 0)
        return (
          <div key={iso} className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800 capitalize">{fmtDagHeader(datum)}</span>
              <span className="text-xs text-slate-500">
                {rollen.length} {rollen.length === 1 ? 'rol' : 'rollen'} · {totStukken} {totStukken === 1 ? 'stuk' : 'stuks'} · {Math.floor(totMin / 60)}u {totMin % 60}m
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 px-4">Tijd</th>
                  <th className="py-2 px-4">Rol</th>
                  <th className="py-2 px-4">Kwaliteit · Kleur</th>
                  <th className="py-2 px-4">Stuks</th>
                  <th className="py-2 px-4">Orders</th>
                  <th className="py-2 px-4">Duur</th>
                  <th className="py-2 px-4">Leverdatum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rollen.map((b) => {
                  const uren = Math.floor(b.duurMinuten / 60)
                  const min = b.duurMinuten % 60
                  const orders = Array.from(new Map(b.stukken.map((s) => [s.order_id, s.order_nr])).entries())
                  return (
                    <tr key={b.rolId} className={cn('hover:bg-slate-50', b.teLaat && 'bg-red-50/50')}>
                      <td className="py-2 px-4 tabular-nums whitespace-nowrap">
                        {fmtTijd(b.start)}–{fmtTijd(b.eind)}
                        {isoDatum(b.start) !== isoDatum(b.eind) && (
                          <span className="text-xs text-slate-400 ml-1">(→ {formatDate(isoDatum(b.eind))})</span>
                        )}
                      </td>
                      <td className="py-2 px-4 font-medium whitespace-nowrap">{b.rolnummer}</td>
                      <td className="py-2 px-4 text-slate-700 whitespace-nowrap">{b.kwaliteitCode} · {b.kleurCode}</td>
                      <td className="py-2 px-4 tabular-nums">{b.stukken.length}</td>
                      <td className="py-2 px-4">
                        <span className="flex flex-wrap gap-1.5">
                          {orders.map(([id, nr]) => (
                            <Link key={id} to={`/orders/${id}`} className="text-terracotta-600 hover:underline text-xs whitespace-nowrap">
                              {nr}
                            </Link>
                          ))}
                        </span>
                      </td>
                      <td className="py-2 px-4 tabular-nums whitespace-nowrap">{uren > 0 ? `${uren}u ` : ''}{min}m</td>
                      <td className={cn('py-2 px-4 whitespace-nowrap', b.teLaat && 'text-red-700 font-medium')}>
                        {b.vroegsteLeverdatum ? (
                          <span className="inline-flex items-center gap-1">
                            {b.teLaat && <AlertTriangle size={12} />}
                            {formatDate(b.vroegsteLeverdatum)}
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
          </div>
        )
      })}
      <div className="text-center text-sm text-slate-500 py-2">
        Backlog volledig verwerkt op <strong>{formatDate(isoDatum(blokken[blokken.length - 1].eind))}</strong>
      </div>
    </div>
  )
}

export function MasterPlanningPage() {
  const [startVanaf, setStartVanaf] = useState(() => isoDatum(new Date()))
  const [zoek, setZoek] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('kwaliteit')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [viewMode, setViewMode] = useState<ViewMode>('tabel')
  const [toonMateriaaltekort, setToonMateriaaltekort] = useState(false)

  const { data: masterPlanning, isLoading } = useMasterPlanning()
  const { data: planningConfig } = usePlanningConfig()
  const { data: werktijden } = useQuery({ queryKey: ['werkagenda-config'], queryFn: fetchWerkagendaConfig })
  const { data: vormTarieven } = useVormSnijtijden()
  const { data: moeilijkeKwaliteiten } = useMoeilijkeKwaliteiten()

  // Agenda-simulatie alleen op de Gepland/Snijden-subset — al-gesneden stukken
  // horen niet in een toekomst-wachtrij-simulatie.
  const blokken = useMemo(() => {
    if (!masterPlanning || !planningConfig || !werktijden || !vormTarieven || !moeilijkeKwaliteiten) return []
    const teSnijdenRows = masterPlanning.rows.filter((r) => (TE_SNIJDEN as readonly string[]).includes(r.status))
    const start = new Date(`${startVanaf}T00:00:00`)
    return berekenAgenda(teSnijdenRows, werktijden, planningConfig, vormTarieven, moeilijkeKwaliteiten, start)
  }, [masterPlanning, planningConfig, werktijden, vormTarieven, moeilijkeKwaliteiten, startVanaf])

  const rolEindMap = useMemo(() => new Map(blokken.map((b) => [b.rolId, b.eind])), [blokken])

  const totaalSnijMinuten = useMemo(() => blokken.reduce((s, b) => s + b.duurMinuten, 0), [blokken])
  const backlogEinde = blokken.length > 0 ? blokken[blokken.length - 1].eind : null

  const rijen = useMemo<MasterPlanningRij[]>(() => {
    if (!masterPlanning || !planningConfig || !werktijden) return []
    const vandaag = isoDatum(new Date())
    return masterPlanning.rows.map((r) => {
      const actueleFase = bepaalMaatwerkFase([{ status: r.status }])
      const alGesneden = TERMINALE_FASE_STATUSSEN.has(r.status)

      let snijDatum: string | null = null
      if (alGesneden) {
        snijDatum = r.gesneden_datum
      } else if (r.rol_id != null) {
        const eind = rolEindMap.get(r.rol_id)
        snijDatum = eind ? isoDatum(eind) : null
      }

      const inkoop = r.verwacht_inkooporder_regel_id != null
        ? masterPlanning.inkoopInfo.get(r.verwacht_inkooporder_regel_id)
        : undefined
      const ingedeeldeRol: IngedeeldeRol = r.rol_id != null
        ? { type: 'rol', label: r.rolnummer ?? '?' }
        : inkoop
          ? {
              type: 'inkoop',
              label: `${inkoop.inkooporder_nr} · verwacht ${formatDate(inkoop.verwacht_datum)}`,
              achterstallig: isAchterstalligeEta(inkoop.verwacht_datum),
            }
          : { type: 'tekort', label: 'Geen rol, geen inkoop' }

      let statusKolom: RijStatus | null = null
      let verwachteVerzendDatum: string | null = null
      if (!alGesneden && r.afleverdatum) {
        const isMateriaaltekort = r.rol_id == null && r.verwacht_inkooporder_regel_id == null
        if (isMateriaaltekort) {
          statusKolom = 'materiaaltekort'
        } else {
          const referentieDatum = snijDatum ?? vandaag
          statusKolom = berekenHaalbaarheid(r.afleverdatum, r.lever_type ?? 'week', planningConfig, werktijden, referentieDatum).status
        }
        if (snijDatum) {
          const bufferDagen = (r.lever_type ?? 'week') === 'datum'
            ? planningConfig.dag_order_snij_buffer_werkdagen
            : planningConfig.logistieke_buffer_dagen
          verwachteVerzendDatum = leverdatumVoorSnijDatum(snijDatum, bufferDagen, werktijden)
        }
      }

      return { ...r, snijDatum, ingedeeldeRol, statusKolom, actueleFase, verwachteVerzendDatum }
    })
  }, [masterPlanning, planningConfig, werktijden, rolEindMap])

  const filtered = useMemo(() => {
    if (!zoek.trim()) return rijen
    const q = zoek.toLowerCase()
    return rijen.filter(
      (r) =>
        r.order_nr.toLowerCase().includes(q) ||
        r.klant_naam.toLowerCase().includes(q) ||
        (r.kwaliteit_code ?? '').toLowerCase().includes(q) ||
        (r.kleur_code ?? '').toLowerCase().includes(q),
    )
  }, [rijen, zoek])

  const sorted = useMemo(() => {
    const cmp = (a: string | null, b: string | null): number => {
      if (a === b) return 0
      if (a == null) return 1
      if (b == null) return -1
      return a.localeCompare(b)
    }
    const arr = [...filtered]
    arr.sort((a, b) => {
      let c = 0
      if (sortKey === 'kwaliteit') {
        c = cmp(a.kwaliteit_code, b.kwaliteit_code)
        if (c === 0) c = cmp(a.kleur_code, b.kleur_code)
        if (c === 0) c = cmp(a.afleverdatum, b.afleverdatum)
      } else if (sortKey === 'snijdatum') {
        c = cmp(a.snijDatum, b.snijDatum)
      } else if (sortKey === 'leverdatum') {
        c = cmp(a.afleverdatum, b.afleverdatum)
      } else if (sortKey === 'klant') {
        c = a.klant_naam.localeCompare(b.klant_naam, 'nl-NL', { sensitivity: 'base' })
      } else if (sortKey === 'status') {
        const sa = a.statusKolom ? STATUS_VOLGORDE[a.statusKolom] : 3
        const sb = b.statusKolom ? STATUS_VOLGORDE[b.statusKolom] : 3
        c = sa - sb
      }
      return sortDir === 'asc' ? c : -c
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const materiaaltekortRijen = useMemo(
    () => rijen.filter((r) => r.statusKolom === 'materiaaltekort'),
    [rijen],
  )

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  // Samenvatting: orders op schema/risico/te laat — alleen orders met ≥1 nog
  // niet-gesneden regel tellen mee (bij al-gesneden orders is de vraag al
  // beantwoord). Materiaaltekort telt voor die rollup als 'rood' (geen dekking
  // is per definitie niet op schema), maar krijgt daarnaast een eigen,
  // regel-niveau telling.
  const summary = useMemo(() => {
    const orderWorst = new Map<number, HaalbaarheidStatus>()
    let materiaaltekortRegels = 0
    for (const r of rijen) {
      if (r.statusKolom === 'materiaaltekort') materiaaltekortRegels++
      if (r.statusKolom == null) continue
      const effectief: HaalbaarheidStatus = r.statusKolom === 'materiaaltekort' ? 'rood' : r.statusKolom
      const huidig = orderWorst.get(r.order_id)
      if (!huidig || STATUS_VOLGORDE[effectief] < STATUS_VOLGORDE[huidig]) {
        orderWorst.set(r.order_id, effectief)
      }
    }
    let opSchema = 0, risico = 0, teLaat = 0
    for (const status of orderWorst.values()) {
      if (status === 'groen') opSchema++
      else if (status === 'oranje') risico++
      else teLaat++
    }
    return {
      openstaandeOrders: new Set(rijen.map((r) => r.order_id)).size,
      totaalKarpetten: rijen.length,
      opSchema,
      risico,
      teLaat,
      materiaaltekortRegels,
    }
  }, [rijen])

  return (
    <>
      <PageHeader
        title="Productie Master Planning"
        description="Volledig overzicht per orderregel — wat staat open, wanneer is het klaar, en op welke rol/inkoop is het ingedeeld?"
      />

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Start produceren vanaf</label>
          <input
            type="date"
            value={startVanaf}
            onChange={(e) => setStartVanaf(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        {viewMode === 'tabel' && (
          <div className="relative w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              placeholder="Zoek op order, klant, kwaliteit, kleur..."
              className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
          </div>
        )}
        <div className="flex rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden text-xs">
          <button
            onClick={() => setViewMode('tabel')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 transition-colors',
              viewMode === 'tabel' ? 'bg-terracotta-500 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <List size={13} /> Tabel
          </button>
          <button
            onClick={() => setViewMode('per_dag')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 transition-colors border-l border-slate-200',
              viewMode === 'per_dag' ? 'bg-terracotta-500 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <Calendar size={13} /> Per dag
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
        {[
          { label: 'Openstaande orders', value: summary.openstaandeOrders, cls: 'text-slate-700' },
          { label: 'Totaal karpetten', value: summary.totaalKarpetten, cls: 'text-slate-700' },
          { label: 'Rollen te pakken', value: blokken.length, cls: 'text-slate-700' },
          { label: 'Snijtijd nodig', value: `${Math.floor(totaalSnijMinuten / 60)}u ${totaalSnijMinuten % 60}m`, cls: 'text-slate-700' },
          { label: 'Backlog klaar op', value: backlogEinde ? formatDate(isoDatum(backlogEinde)) : '—', cls: 'text-slate-700' },
          { label: 'Op schema', value: summary.opSchema, cls: 'text-emerald-600' },
          { label: 'Risico', value: summary.risico, cls: 'text-amber-600' },
          { label: 'Te laat', value: summary.teLaat, cls: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-3">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className={cn('text-xl font-semibold', s.cls)}>{s.value}</div>
          </div>
        ))}
      </div>

      {summary.materiaaltekortRegels > 0 && (
        <button
          onClick={() => setToonMateriaaltekort(true)}
          className="flex items-center gap-2 w-full px-4 py-3 mb-4 bg-purple-50 border border-purple-200 rounded-[var(--radius)] text-sm text-purple-700 hover:bg-purple-100 transition-colors text-left"
        >
          <PackageX size={16} className="flex-shrink-0" />
          <strong>{summary.materiaaltekortRegels}</strong> regels hebben geen rol én geen inkoop — echt materiaaltekort.
          <span className="text-xs text-purple-500 ml-auto">Klik voor details →</span>
        </button>
      )}

      {toonMateriaaltekort && (
        <MateriaaltekortModal rijen={materiaaltekortRijen} onClose={() => setToonMateriaaltekort(false)} />
      )}

      {viewMode === 'per_dag' ? (
        isLoading ? (
          <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">Laden...</div>
        ) : (
          <PerDagWeergave blokken={blokken} />
        )
      ) : (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Laden...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Geen openstaande maatwerkorders gevonden</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <button onClick={() => toggleSort('snijdatum')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Snijdatum <SortIcon active={sortKey === 'snijdatum'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <button onClick={() => toggleSort('kwaliteit')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Kwaliteit · Kleur <SortIcon active={sortKey === 'kwaliteit'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <button onClick={() => toggleSort('klant')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Klant <SortIcon active={sortKey === 'klant'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Afmeting</th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap">Aantal</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Afwerking</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Order</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Ingedeelde rol</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <button onClick={() => toggleSort('leverdatum')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Verzendweek (gevraagd) <SortIcon active={sortKey === 'leverdatum'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Verzendweek (planning)</th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                  <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Status <SortIcon active={sortKey === 'status'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Actueel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const vorm = getVormDisplay(r.maatwerk_vorm)
                const afwerking = r.maatwerk_afwerking ? AFWERKING_MAP[r.maatwerk_afwerking] : null
                const fase = MAATWERK_FASE_PRESENTATIE[r.actueleFase]
                const statusBadge = r.statusKolom ? STATUS_BADGE[r.statusKolom] : null
                return (
                  <tr key={r.id} className={cn('hover:bg-slate-50/60', r.statusKolom === 'rood' && 'bg-red-50/30', r.statusKolom === 'materiaaltekort' && 'bg-purple-50/30')}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {r.snijDatum ? formatDate(r.snijDatum) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{r.kwaliteit_code} · {r.kleur_code}</td>
                    <td className="px-4 py-3 text-slate-700">{r.klant_naam}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {r.snij_lengte_cm}×{r.snij_breedte_cm} cm
                      {vorm.label && <span className="block text-xs text-slate-400">{vorm.label}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{r.orderaantal}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {afwerking ? (
                        <span className={cn('px-1.5 py-0.5 rounded text-xs', afwerking.bg, afwerking.text)}>
                          {afwerking.code}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link to={`/orders/${r.order_id}`} className="font-medium text-terracotta-600 hover:underline">
                        {r.order_nr}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn(
                        r.ingedeeldeRol.achterstallig
                          ? 'text-red-600 font-medium'
                          : r.ingedeeldeRol.type === 'tekort' ? 'text-red-600' : r.ingedeeldeRol.type === 'inkoop' ? 'text-orange-600' : 'text-slate-700',
                      )}>
                        {r.ingedeeldeRol.achterstallig && '⚠ '}{r.ingedeeldeRol.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      <VerzendweekCel datum={r.afleverdatum} leverType={r.lever_type ?? 'week'} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      <VerzendweekCel datum={r.verwachteVerzendDatum} leverType={r.lever_type ?? 'week'} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {statusBadge ? (
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusBadge.bg, statusBadge.text)}>
                          {statusBadge.label}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', fase.bg, fase.text)}>
                        {fase.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
    </>
  )
}
