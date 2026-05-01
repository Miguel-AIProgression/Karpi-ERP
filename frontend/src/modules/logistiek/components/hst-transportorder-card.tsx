import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
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
  extern_transport_order_id: string | null
  extern_tracking_number: string | null
  request_payload: unknown
  response_payload: unknown
  response_http_code: number | null
  retry_count: number
  error_msg: string | null
  is_test: boolean
  sent_at: string | null
  created_at: string
}

interface HstTransportorderCardProps {
  row: HstTransportorderRow
  onRetry: () => void
  retryBusy: boolean
}

export function HstTransportorderCard({ row, onRetry, retryBusy }: HstTransportorderCardProps) {
  const kleur = HST_STATUS_KLEUREN[row.status]
  const kanRetry = row.status === 'Fout'

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
        {kanRetry && (
          <button
            onClick={onRetry}
            disabled={retryBusy}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium hover:bg-rose-100 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {retryBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Opnieuw versturen
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
        <Field label="Verstuurd">{row.sent_at ? formatDateTime(row.sent_at) : '—'}</Field>
        <Field label="HST transportOrderId">
          <span className="font-mono">{row.extern_transport_order_id ?? '—'}</span>
        </Field>
        <Field label="Tracking">
          <span className="font-mono">{row.extern_tracking_number ?? '—'}</span>
        </Field>
        <Field label="HTTP-code">{row.response_http_code ?? '—'}</Field>
      </div>

      {row.error_msg && (
        <div className="mb-3 p-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50">
          <div className="text-xs font-medium text-rose-800 mb-1">Foutmelding</div>
          <pre className="text-xs text-rose-700 whitespace-pre-wrap break-words">{row.error_msg}</pre>
        </div>
      )}

      {row.request_payload != null && (
        <PayloadBlok titel="Request payload" payload={row.request_payload} />
      )}
      {row.response_payload != null && (
        <PayloadBlok titel="Response payload" payload={row.response_payload} dark />
      )}
    </div>
  )
}

function PayloadBlok({
  titel,
  payload,
  dark = false,
}: {
  titel: string
  payload: unknown
  dark?: boolean
}) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{titel}</div>
      <pre
        className={cn(
          'rounded-[var(--radius-sm)] border p-3 text-xs overflow-auto max-h-[320px]',
          dark
            ? 'bg-slate-900 text-slate-100 border-slate-700 font-mono'
            : 'bg-slate-50 text-slate-800 border-slate-200',
        )}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
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

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  )
}
