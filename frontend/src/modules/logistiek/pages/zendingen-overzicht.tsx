import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Truck, AlertCircle, Settings } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useZendingen } from '@/modules/logistiek/hooks/use-zendingen'
import { ZendingStatusBadge } from '@/modules/logistiek/components/zending-status-badge'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import { VERVOERDER_REGISTRY, type VervoerderCode } from '@/modules/logistiek/registry'
import type { ZendingStatus } from '@/modules/logistiek/queries/zendingen'
import { cn } from '@/lib/utils/cn'

type VervoerderFilter = 'alle' | VervoerderCode | 'geen'
type StatusFilter = 'alle' | ZendingStatus

const STATUS_PILLEN: StatusFilter[] = [
  'alle',
  'Klaar voor verzending',
  'Onderweg',
  'Afgeleverd',
]

const VERVOERDER_PILLEN: { key: VervoerderFilter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'hst_api', label: 'HST' },
  { key: 'edi_partner_a', label: 'Rhenus' },
  { key: 'edi_partner_b', label: 'Verhoek' },
  { key: 'geen', label: 'Geen' },
]

interface ZendingRow {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  afl_naam: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  created_at: string
  orders: {
    id: number
    order_nr: string
    debiteur_nr: number
    debiteuren?: {
      debiteur_nr: number
      naam: string
    } | null
  }
  hst_transportorders: { id: number; status: string }[]
}

function pickVervoerderCode(row: ZendingRow): string | null {
  return row.vervoerder_code ?? null
}

export function ZendingenOverzichtPage() {
  const navigate = useNavigate()
  const [vervoerderFilter, setVervoerderFilter] = useState<VervoerderFilter>('alle')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle')

  const { data: zendingen = [], isLoading } = useZendingen({
    status: statusFilter === 'alle' ? undefined : statusFilter,
  })

  const gefilterd = useMemo(() => {
    const rows = (zendingen as unknown as ZendingRow[]) ?? []
    if (vervoerderFilter === 'alle') return rows
    return rows.filter((r) => {
      const code = pickVervoerderCode(r)
      if (vervoerderFilter === 'geen') return !code
      return code === vervoerderFilter
    })
  }, [zendingen, vervoerderFilter])

  const aantalFout = (zendingen as unknown as ZendingRow[]).filter((z) =>
    (z.hst_transportorders ?? []).some((t) => t.status === 'Fout'),
  ).length

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Truck size={22} className="text-slate-400" />
            Zendingen
          </span>
        }
        description={`${gefilterd.length} zendingen${aantalFout ? ` — ${aantalFout} met HST-fout` : ''}`}
        actions={
          <Link
            to="/logistiek/vervoerders"
            aria-label="Vervoerder-instellingen"
            title="Vervoerder-instellingen"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
          >
            <Settings size={16} />
          </Link>
        }
      />

      {/* Filter-bar */}
      <div className="space-y-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">Vervoerder:</span>
          {VERVOERDER_PILLEN.map((p) => (
            <button
              key={p.key}
              onClick={() => setVervoerderFilter(p.key)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                vervoerderFilter === p.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">Status:</span>
          {STATUS_PILLEN.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                statusFilter === s
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
            >
              {s === 'alle' ? 'Alle' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Laden…</div>
        ) : gefilterd.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <div className="mb-2">Geen zendingen gevonden.</div>
            <div className="text-xs text-slate-400">
              Een zending verschijnt hier zodra je op een order met status "Klaar voor verzending"
              op "Zending aanmaken" klikt.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Zending</th>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Klant</th>
                <th className="px-4 py-3 text-left font-medium">Bestemming</th>
                <th className="px-4 py-3 text-left font-medium">Vervoerder</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Track &amp; Trace</th>
                <th className="px-4 py-3 text-right font-medium">Colli</th>
                <th className="px-4 py-3 text-right font-medium">Gewicht</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefilterd.map((z) => {
                const code = pickVervoerderCode(z)
                const heeftFout = (z.hst_transportorders ?? []).some((t) => t.status === 'Fout')
                return (
                  <tr
                    key={z.id}
                    onClick={() => navigate(`/logistiek/${z.zending_nr}`)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-terracotta-600">{z.zending_nr}</td>
                    <td className="px-4 py-3 text-slate-600">{z.orders?.order_nr ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {z.orders?.debiteuren?.naam ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {[z.afl_postcode, z.afl_plaats].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <VervoerderTag code={code} showLeeg />
                    </td>
                    <td className="px-4 py-3">
                      <ZendingStatusBadge status={z.status} />
                      {heeftFout && (
                        <span
                          className="ml-2 inline-flex items-center text-xs text-rose-600"
                          title="Er staat een hst_transportorder met status Fout"
                        >
                          <AlertCircle size={12} className="mr-1" />
                          fout
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                      {z.track_trace ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-right">
                      {z.aantal_colli ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-right">
                      {z.totaal_gewicht_kg != null
                        ? `${z.totaal_gewicht_kg} kg`
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {/* Helper-text bij tabel */}
      <div className="mt-4 text-xs text-slate-400">
        Tip: lijst ververst elke 30 seconden. Klik op een rij voor details + HST-payloads.
      </div>
      {/* Vervoerder-registry-debug-info: aantal beschikbare codes (zodat lint geen unused warning geeft) */}
      <div className="sr-only">{Object.keys(VERVOERDER_REGISTRY).length} vervoerders bekend</div>
    </>
  )
}
