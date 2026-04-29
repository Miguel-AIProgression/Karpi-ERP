import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Search, ArrowDownCircle, ArrowUpCircle, AlertCircle, Beaker, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useEdiBerichten } from '@/hooks/use-edi'
import { DemoBerichtDialog } from '@/components/edi/demo-bericht-dialog'
import { ruimEdiDemoData, type EdiBerichtStatus, type EdiRichting, type EdiBerichtType } from '@/lib/supabase/queries/edi'
import { cn } from '@/lib/utils/cn'

const ALLE_STATUSSEN: EdiBerichtStatus[] = [
  'Wachtrij', 'Bezig', 'Verstuurd', 'Verwerkt', 'Fout', 'Geannuleerd',
]
const ALLE_TYPES: EdiBerichtType[] = ['order', 'orderbev', 'factuur', 'verzendbericht']

const STATUS_KLEUREN: Record<EdiBerichtStatus, { bg: string; text: string }> = {
  Wachtrij:    { bg: 'bg-amber-100',  text: 'text-amber-700' },
  Bezig:       { bg: 'bg-blue-100',   text: 'text-blue-700' },
  Verstuurd:   { bg: 'bg-green-100',  text: 'text-green-700' },
  Verwerkt:    { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  Fout:        { bg: 'bg-rose-100',   text: 'text-rose-700' },
  Geannuleerd: { bg: 'bg-gray-100',   text: 'text-gray-500' },
}

const TYPE_LABELS: Record<EdiBerichtType, string> = {
  order: 'Order in',
  orderbev: 'Orderbevestiging',
  factuur: 'Factuur',
  verzendbericht: 'Verzendbericht',
}

export function EdiBerichtenOverzichtPage() {
  const [zoekterm, setZoekterm] = useState('')
  const [richtingFilter, setRichtingFilter] = useState<'alle' | EdiRichting>('alle')
  const [statusFilter, setStatusFilter] = useState<'alle' | EdiBerichtStatus>('alle')
  const [typeFilter, setTypeFilter] = useState<'alle' | EdiBerichtType>('alle')
  const [demoOpen, setDemoOpen] = useState(false)
  const [opruimBusy, setOpruimBusy] = useState(false)
  const qc = useQueryClient()

  async function handleOpruim() {
    if (!confirm('Alle EDI-test-data verwijderen? Dit verwijdert alle berichten met TEST-vlag én de bijbehorende demo-orders.')) return
    setOpruimBusy(true)
    try {
      const res = await ruimEdiDemoData()
      alert(`Opgeruimd: ${res.verwijderde_orders} orders en ${res.verwijderde_berichten} berichten.`)
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
    } catch (err) {
      alert('Opruimen mislukt: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setOpruimBusy(false)
    }
  }

  const { data: berichten = [], isLoading } = useEdiBerichten({
    richting: richtingFilter === 'alle' ? undefined : richtingFilter,
    status: statusFilter === 'alle' ? undefined : statusFilter,
    berichttype: typeFilter === 'alle' ? undefined : typeFilter,
  })

  const gefilterd = useMemo(() => {
    const q = zoekterm.trim().toLowerCase()
    if (!q) return berichten
    return berichten.filter((b) =>
      (b.transactie_id ?? '').toLowerCase().includes(q) ||
      (b.klant_naam ?? '').toLowerCase().includes(q) ||
      (b.order_nr ?? '').toLowerCase().includes(q) ||
      (b.factuur_nr ?? '').toLowerCase().includes(q),
    )
  }, [berichten, zoekterm])

  const aantalFout = berichten.filter((b) => b.status === 'Fout').length

  return (
    <>
      <PageHeader
        title="EDI-berichten"
        description={`${gefilterd.length} berichten${aantalFout ? ` — ${aantalFout} met fout` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpruim}
              disabled={opruimBusy}
              className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 disabled:opacity-50 inline-flex items-center gap-2"
              title="Verwijder alle test-berichten en demo-orders"
            >
              <Trash2 size={14} />
              Demo-data opruimen
            </button>
            <button
              onClick={() => setDemoOpen(true)}
              className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-2"
            >
              <Beaker size={14} />
              Demo-bericht
            </button>
          </div>
        }
      />
      <DemoBerichtDialog open={demoOpen} onClose={() => setDemoOpen(false)} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            placeholder="Zoek op TransactionID, klant, order- of factuurnr…"
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        <select
          value={richtingFilter}
          onChange={(e) => setRichtingFilter(e.target.value as typeof richtingFilter)}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white"
        >
          <option value="alle">In + uit</option>
          <option value="in">Inkomend</option>
          <option value="uit">Uitgaand</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white"
        >
          <option value="alle">Alle types</option>
          {ALLE_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white"
        >
          <option value="alle">Alle statussen</option>
          {ALLE_STATUSSEN.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Laden…</div>
        ) : gefilterd.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <div className="mb-2">Geen berichten gevonden.</div>
            <div className="text-xs text-slate-400">
              Inkomende berichten verschijnen automatisch zodra de transus-poll cron actief is.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium w-12"></th>
                <th className="px-4 py-3 text-left font-medium">Tijdstip</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Klant</th>
                <th className="px-4 py-3 text-left font-medium">Referentie</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">TransactionID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefilterd.map((b) => {
                const kleur = STATUS_KLEUREN[b.status]
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/edi/berichten/${b.id}`}
                        className="flex items-center justify-center text-slate-400 hover:text-terracotta-500"
                        title={b.richting === 'in' ? 'Ontvangen' : 'Verstuurd'}
                      >
                        {b.richting === 'in' ? (
                          <ArrowDownCircle size={18} />
                        ) : (
                          <ArrowUpCircle size={18} />
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {formatDateTime(b.created_at)}
                      {b.is_test && <span className="ml-2 text-xs text-amber-600 font-medium">TEST</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/edi/berichten/${b.id}`} className="text-slate-700 hover:text-terracotta-500">
                        {TYPE_LABELS[b.berichttype]}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {b.klant_naam ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {b.order_nr ? (
                        <Link to={`/orders/${b.order_id}`} className="text-terracotta-600 hover:underline">{b.order_nr}</Link>
                      ) : b.factuur_nr ? (
                        <Link to={`/facturatie/${b.factuur_id}`} className="text-terracotta-600 hover:underline">{b.factuur_nr}</Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', kleur.bg, kleur.text)}>
                        {b.status === 'Fout' && <AlertCircle size={12} className="mr-1" />}
                        {b.status}
                      </span>
                      {b.retry_count > 0 && (
                        <span className="ml-2 text-xs text-slate-500">×{b.retry_count}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                      {b.transactie_id ?? <span className="text-slate-400">—</span>}
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

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}
