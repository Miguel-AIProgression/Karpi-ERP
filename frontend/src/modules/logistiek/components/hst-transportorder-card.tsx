import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDateTime } from '@/lib/utils/formatters'
import type { HstTransportorderStatus } from '@/modules/logistiek/queries/zendingen'

const HST_STATUS_KLEUREN: Record<HstTransportorderStatus, { bg: string; text: string }> = {
  Wachtrij:    { bg: 'bg-amber-100',  text: 'text-amber-700' },
  Bezig:       { bg: 'bg-blue-100',   text: 'text-blue-700' },
  Verstuurd:   { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  Fout:        { bg: 'bg-rose-100',   text: 'text-rose-700' },
  Geannuleerd: { bg: 'bg-gray-100',   text: 'text-gray-500' },
}

export interface HstTransportorderRow {
  id: number
  status: HstTransportorderStatus
  /** Mig 424 (ADR-0038): externe referentie (HST transportOrderId / SFTP-bestandsnaam). */
  extern_referentie: string | null
  /** Mig 424: track & trace-code van de vervoerder. */
  track_trace: string | null
  retry_count: number
  error_msg: string | null
  is_test: boolean
  sent_at: string | null
  created_at: string
}

interface HstTransportorderCardProps {
  row: HstTransportorderRow
  /** Markeer als afgehandeld zonder opnieuw te versturen (de fout is in de HST-portal opgelost). */
  onAfgehandeld: () => void
  afhandelBusy: boolean
}

export function HstTransportorderCard({ row, onAfgehandeld, afhandelBusy }: HstTransportorderCardProps) {
  const kleur = HST_STATUS_KLEUREN[row.status]
  const isFout = row.status === 'Fout'

  return (
    <div className="border border-slate-200 rounded-[var(--radius)] p-4">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-700">#{row.id}</span>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
              kleur.bg,
              kleur.text,
            )}
          >
            {row.status === 'Fout' && <AlertCircle size={12} className="mr-1" />}
            {row.status}
          </span>
          {row.is_test && (
            <span className="text-xs text-amber-600 font-medium">TEST</span>
          )}
          {row.retry_count > 0 && (
            <span className="text-xs text-slate-500">retries: {row.retry_count}</span>
          )}
        </div>
        {isFout && (
          <button
            onClick={onAfgehandeld}
            disabled={afhandelBusy}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {afhandelBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Markeer afgehandeld (HST)
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs mb-3">
        <Field label="Verstuurd">{row.sent_at ? formatDateTime(row.sent_at) : '—'}</Field>
        <Field label="Externe referentie">
          <span className="font-mono">{row.extern_referentie ?? '—'}</span>
        </Field>
        <Field label="Track & Trace">
          <span className="font-mono">{row.track_trace ?? '—'}</span>
        </Field>
      </div>

      {row.error_msg && (
        <div className="mb-3 p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50">
          <div className="text-xs font-medium text-rose-800 mb-1">Foutmelding</div>
          <pre className="text-xs text-rose-700 whitespace-pre-wrap break-words">{row.error_msg}</pre>
        </div>
      )}

      {isFout && (
        <p className="text-xs text-slate-500">
          Deze zending staat ook al in de HST-portal. Pas de fout dáár aan en klik
          dan op <span className="font-medium">Markeer afgehandeld</span> — niet opnieuw
          versturen (dat maakt een dubbele transportorder).
        </p>
      )}
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  )
}
