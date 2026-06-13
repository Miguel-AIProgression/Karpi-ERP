import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Truck, Copy, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { ZendingStatusBadge, VervoerderTag } from '@/modules/logistiek'
import { formatDate } from '@/lib/utils/formatters'

interface OrderZending {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  aantal_colli: number | null
}

async function fetchZendingenVoorOrder(orderId: number): Promise<OrderZending[]> {
  // Mig 222: orders-per-zending via M2M zending_orders (backfill heeft
  // 1-op-1 zendingen ook gevuld, dus deze route dekt solo én bundel).
  const { data, error } = await supabase
    .from('zending_orders')
    .select(
      'zendingen ( id, zending_nr, status, vervoerder_code, verzenddatum, track_trace, aantal_colli )',
    )
    .eq('order_id', orderId)
  if (error) throw error
  return (data ?? [])
    .map((row) => (row as unknown as { zendingen: OrderZending | null }).zendingen)
    .filter((z): z is OrderZending => z != null)
    .sort((a, b) => a.zending_nr.localeCompare(b.zending_nr))
}

export function useZendingenVoorOrder(orderId: number) {
  return useQuery({
    queryKey: ['order-zendingen', orderId],
    queryFn: () => fetchZendingenVoorOrder(orderId),
    staleTime: 30_000,
  })
}

function TrackTraceCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const kopieer = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-slate-600">{code}</span>
      <button
        type="button"
        onClick={kopieer}
        title="Track & trace-code kopiëren"
        className="text-slate-400 hover:text-slate-600 transition-colors"
      >
        {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </button>
    </span>
  )
}

/**
 * Zendingen-blok op order-detail: per zending de status, vervoerder en
 * track & trace-code — zodat een operator niet naar de Zendingen-pagina
 * hoeft voor de T&T van een specifieke order.
 * Rendert null zolang er geen zendingen zijn (gouden regel).
 */
export function OrderZendingen({ orderId }: { orderId: number }) {
  const { data: zendingen = [] } = useZendingenVoorOrder(orderId)

  if (zendingen.length === 0) return null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Truck size={15} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Zendingen
        </h2>
      </div>

      <ul className="divide-y divide-slate-100">
        {zendingen.map((z) => (
          <li
            key={z.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
          >
            <Link
              to={`/logistiek/${z.zending_nr}`}
              className="font-mono text-sm text-terracotta-500 hover:underline"
            >
              {z.zending_nr}
            </Link>
            <ZendingStatusBadge status={z.status} />
            <VervoerderTag code={z.vervoerder_code} showLeeg />
            {z.verzenddatum && (
              <span className="text-xs text-slate-400">{formatDate(z.verzenddatum)}</span>
            )}
            <span className="ml-auto">
              {z.track_trace ? (
                <TrackTraceCode code={z.track_trace} />
              ) : (
                <span
                  className="text-xs text-slate-400 italic"
                  title="De track & trace-code verschijnt zodra de vervoerder de transportorder heeft aangenomen"
                >
                  nog geen track &amp; trace
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
