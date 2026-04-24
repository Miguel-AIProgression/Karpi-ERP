import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardList, Package, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useInkooporders, useInkooporderStats } from '@/hooks/use-inkooporders'
import { useLeveranciersOverzicht } from '@/hooks/use-leveranciers'
import { InkooporderStatusBadge } from '@/components/inkooporders/inkooporder-status-badge'
import { InkooporderFormDialog } from '@/components/inkooporders/inkooporder-form-dialog'
import type { InkooporderStatus } from '@/lib/supabase/queries/inkooporders'

const STATUSSEN: (InkooporderStatus | 'alle')[] = [
  'alle',
  'Concept',
  'Besteld',
  'Deels ontvangen',
  'Ontvangen',
  'Geannuleerd',
]

function formatAantal(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

function formatDatum(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function InkooporderOverviewPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<InkooporderStatus | 'alle'>('alle')
  const [leverancierId, setLeverancierId] = useState<number | 'alle'>('alle')
  const [alleenOpen, setAlleenOpen] = useState(true)
  const [zoek, setZoek] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const { data: orders = [], isLoading } = useInkooporders({
    status,
    leverancier_id: leverancierId,
    alleen_open: alleenOpen,
    zoek,
  })
  const { data: stats } = useInkooporderStats()
  const { data: leveranciers = [] } = useLeveranciersOverzicht()

  const statCards = [
    {
      label: 'Openstaande orders',
      value: stats?.openstaande_orders ?? 0,
      sub: null,
      icon: ClipboardList,
      color: 'text-slate-700',
    },
    {
      label: 'Openstaand (m + st.)',
      value: formatAantal(stats?.openstaande_meters ?? 0),
      sub: 'totaal te leveren',
      icon: Package,
      color: 'text-indigo-600',
    },
    {
      label: 'Deze week verwacht',
      value: stats?.deze_week ?? 0,
      sub: null,
      icon: CalendarClock,
      color: 'text-emerald-600',
    },
    {
      label: 'Achterstallig',
      value: stats?.achterstallig ?? 0,
      sub: 'verwachte datum voorbij',
      icon: AlertTriangle,
      color: 'text-red-600',
    },
  ]

  return (
    <>
      <PageHeader
        title="Inkooporders"
        description={`${orders.length} orders`}
        actions={
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600"
          >
            <Plus size={16} />
            Nieuwe bestelling
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op ordernr of leverancier…"
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InkooporderStatus | 'alle')}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white"
        >
          {STATUSSEN.map((s) => (
            <option key={s} value={s}>
              {s === 'alle' ? 'Alle statussen' : s}
            </option>
          ))}
        </select>

        <select
          value={leverancierId}
          onChange={(e) =>
            setLeverancierId(e.target.value === 'alle' ? 'alle' : Number(e.target.value))
          }
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white"
        >
          <option value="alle">Alle leveranciers</option>
          {leveranciers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.naam}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={alleenOpen}
            onChange={(e) => setAlleenOpen(e.target.checked)}
            className="rounded border-slate-300"
          />
          Alleen openstaande
        </label>
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Inkooporders laden…</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Geen inkooporders gevonden</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Ordernummer</th>
                <th className="px-4 py-3 text-left font-medium">Leverancier</th>
                <th className="px-4 py-3 text-left font-medium">Besteldatum</th>
                <th className="px-4 py-3 text-left font-medium">Leverweek</th>
                <th className="px-4 py-3 text-right font-medium">Regels</th>
                <th className="px-4 py-3 text-right font-medium">Besteld</th>
                <th className="px-4 py-3 text-right font-medium">Te leveren</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/inkoop/${o.id}`)}
                  className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{o.inkooporder_nr}</span>
                    {o.oud_inkooporder_nr && (
                      <span className="ml-2 text-xs text-slate-400">({o.oud_inkooporder_nr})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{o.leverancier_naam ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDatum(o.besteldatum)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.leverweek ?? formatDatum(o.verwacht_datum)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.aantal_regels}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAantal(o.totaal_besteld_m)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.totaal_te_leveren_m > 0 ? (
                      <span className="font-medium text-slate-800">
                        {formatAantal(o.totaal_te_leveren_m)}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <InkooporderStatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && <InkooporderFormDialog onClose={() => setFormOpen(false)} />}
    </>
  )
}
