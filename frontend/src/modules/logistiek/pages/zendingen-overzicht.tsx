import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Truck, AlertCircle, Settings, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useZendingen } from '@/modules/logistiek/hooks/use-zendingen'
import { ZendingStatusBadge, zendingStatusLabel } from '@/modules/logistiek/components/zending-status-badge'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import { VERVOERDER_REGISTRY, type VervoerderCode } from '@/modules/logistiek/registry'
import type { ZendingStatus } from '@/modules/logistiek/queries/zendingen'
import { cn } from '@/lib/utils/cn'

type VervoerderFilter = 'alle' | VervoerderCode | 'geen'
type StatusFilter = 'alle' | ZendingStatus

const STATUS_PILLEN: StatusFilter[] = [
  'alle',
  'Picken',
  'Klaar voor verzending',
  'Onderweg',
  'Afgehaald',
  'Afgeleverd',
]

const VERVOERDER_PILLEN: { key: VervoerderFilter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'hst_api', label: 'HST' },
  { key: 'rhenus_sftp', label: 'Rhenus' },
  { key: 'verhoek_sftp', label: 'Verhoek' },
  { key: 'geen', label: 'Geen' },
]

/** Aantal kolommen in de tabel — gebruikt voor de datum-kopregel (colSpan). */
const TABEL_KOLOMMEN = 10

/** Groep-sleutel voor zendingen zonder afrond-datum (bv. lopende pickronde). */
const ONBEKEND = 'onbekend'

/** Lokale (NL-tijd) datum-sleutel YYYY-MM-DD voor een ISO-timestamp. */
function lokaleDatumKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Groep-sleutel: afrond-datum (gereed_op) of ONBEKEND. */
function groepKeyVan(z: ZendingRow): string {
  return z.gereed_op ? lokaleDatumKey(z.gereed_op) : ONBEKEND
}

/** Volledig label voor de datum-kopregel ("donderdag 19 juni 2026"). */
function datumKopLabel(key: string): string {
  if (key === ONBEKEND) return 'Nog niet afgerond'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Kort label voor de filter-dropdown ("19-06-2026"). */
function datumKortLabel(key: string): string {
  if (key === ONBEKEND) return 'Nog niet afgerond'
  const [y, m, d] = key.split('-')
  return `${d}-${m}-${y}`
}

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
  /** Mig 432: moment waarop de pickronde werd afgerond (→ 'Klaar voor verzending'). */
  gereed_op: string | null
  orders: {
    id: number
    order_nr: string
    debiteur_nr: number
    debiteuren?: {
      debiteur_nr: number
      naam: string
    } | null
  }
  zending_orders?: Array<{
    order_id: number
    bundel_order: { id: number; order_nr: string } | null
  }>
  /** Mig 424 (ADR-0038): geconsolideerde verzend-wachtrij-rijen. */
  verzend_wachtrij: { id: number; status: string }[]
}

const BUNDEL_PREVIEW_AANTAL = 2

function pickVervoerderCode(row: ZendingRow): string | null {
  return row.vervoerder_code ?? null
}

interface BundelOrderRef {
  id: number
  order_nr: string
}

function BundelOrdersCell({ orders }: { orders: BundelOrderRef[] }) {
  const [uitgevouwen, setUitgevouwen] = useState(false)

  if (orders.length === 0) return <>—</>

  const zichtbaar =
    orders.length <= BUNDEL_PREVIEW_AANTAL || uitgevouwen
      ? orders
      : orders.slice(0, BUNDEL_PREVIEW_AANTAL)
  const verborgen = orders.length - zichtbaar.length

  return (
    <div className="flex flex-col gap-0.5">
      {zichtbaar.map((o) => (
        <Link
          key={o.id}
          to={`/orders/${o.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-slate-600 hover:text-terracotta-600 hover:underline w-fit whitespace-nowrap"
        >
          {o.order_nr}
        </Link>
      ))}
      {verborgen > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setUitgevouwen(true)
          }}
          className="text-[11px] font-medium text-slate-500 hover:text-terracotta-600 hover:underline w-fit"
        >
          + nog {verborgen} {verborgen === 1 ? 'order' : 'orders'}
        </button>
      )}
      {orders.length > BUNDEL_PREVIEW_AANTAL && uitgevouwen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setUitgevouwen(false)
          }}
          className="text-[11px] font-medium text-slate-400 hover:text-slate-600 hover:underline w-fit"
        >
          inklappen
        </button>
      )}
      {orders.length > 1 && (
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          Bundel · {orders.length} orders
        </span>
      )}
    </div>
  )
}

export function ZendingenOverzichtPage() {
  const navigate = useNavigate()
  const [vervoerderFilter, setVervoerderFilter] = useState<VervoerderFilter>('alle')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle')
  const [datumFilter, setDatumFilter] = useState<string>('alle')

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

  // Beschikbare afrond-datums (uit de vervoerder-gefilterde set), in dezelfde
  // volgorde als de query-sortering (gereed_op DESC) zodat de dropdown
  // nieuwste-eerst is.
  const datumOpties = useMemo(() => {
    const keys: string[] = []
    const gezien = new Set<string>()
    for (const r of gefilterd) {
      const k = groepKeyVan(r)
      if (!gezien.has(k)) {
        gezien.add(k)
        keys.push(k)
      }
    }
    return keys
  }, [gefilterd])

  // Pas het gekozen datumfilter toe.
  const naDatum = useMemo(() => {
    if (datumFilter === 'alle') return gefilterd
    return gefilterd.filter((r) => groepKeyVan(r) === datumFilter)
  }, [gefilterd, datumFilter])

  // Groepeer per afrond-dag; insertion-order volgt de query-sortering.
  const groepen = useMemo(() => {
    const map = new Map<string, ZendingRow[]>()
    for (const r of naDatum) {
      const k = groepKeyVan(r)
      const lijst = map.get(k)
      if (lijst) lijst.push(r)
      else map.set(k, [r])
    }
    return Array.from(map.entries())
  }, [naDatum])

  const aantalFout = (zendingen as unknown as ZendingRow[]).filter((z) =>
    (z.verzend_wachtrij ?? []).some((t) => t.status === 'Fout'),
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
        description={`${naDatum.length} zendingen${aantalFout ? ` — ${aantalFout} met verzendfout` : ''}${statusFilter === 'alle' ? ' (lopende Pickrondes verborgen)' : ''}`}
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
              {s === 'alle' ? 'Alle' : zendingStatusLabel(s)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">
            Afgerond op:
          </span>
          <select
            value={datumFilter}
            onChange={(e) => setDatumFilter(e.target.value)}
            className="px-3 py-1 rounded-full text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
          >
            <option value="alle">Alle datums</option>
            {datumOpties.map((k) => (
              <option key={k} value={k}>
                {datumKortLabel(k)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Laden…</div>
        ) : naDatum.length === 0 ? (
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
                <th className="hidden xl:table-cell px-4 py-3 text-left font-medium">T&amp;T</th>
                <th className="px-4 py-3 text-right font-medium">Colli</th>
                <th className="px-4 py-3 text-right font-medium">Gewicht</th>
                <th className="px-4 py-3 text-right font-medium" aria-label="Acties" />
              </tr>
            </thead>
            {groepen.map(([datumKey, rijen]) => (
              <tbody key={datumKey} className="divide-y divide-slate-100">
                <tr className="bg-slate-50/80 border-t border-slate-200">
                  <td
                    colSpan={TABEL_KOLOMMEN}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {datumKopLabel(datumKey)}
                    <span className="ml-2 font-normal normal-case text-slate-400">
                      · {rijen.length} {rijen.length === 1 ? 'zending' : 'zendingen'}
                    </span>
                  </td>
                </tr>
                {rijen.map((z) => {
                  const code = pickVervoerderCode(z)
                const heeftFout = (z.verzend_wachtrij ?? []).some((t) => t.status === 'Fout')
                // Mig 222: bundel-zendingen hebben meerdere orders via `zending_orders`.
                // Backfill heeft solo-zendingen ook in M2M gezet; fallback op primaire
                // `orders` als de M2M leeg is.
                const bundelOrders: BundelOrderRef[] = (z.zending_orders ?? [])
                  .map((row) => row.bundel_order)
                  .filter((o): o is BundelOrderRef => o != null)
                  .sort((a, b) => a.order_nr.localeCompare(b.order_nr))
                const orders: BundelOrderRef[] =
                  bundelOrders.length > 0
                    ? bundelOrders
                    : z.orders
                      ? [{ id: z.orders.id, order_nr: z.orders.order_nr }]
                      : []
                return (
                  <tr
                    key={z.id}
                    onClick={() => navigate(`/logistiek/${z.zending_nr}`)}
                    className="hover:bg-slate-50 cursor-pointer align-top"
                  >
                    <td className="px-4 py-3 font-medium text-terracotta-600 whitespace-nowrap">{z.zending_nr}</td>
                    <td className="px-4 py-3">
                      <BundelOrdersCell orders={orders} />
                    </td>
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
                          title="Er staat een transportorder met status Fout"
                        >
                          <AlertCircle size={12} className="mr-1" />
                          fout
                        </span>
                      )}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 text-slate-500 font-mono text-xs">
                      {z.track_trace ? (
                        <span className="block max-w-[140px] truncate" title={z.track_trace}>
                          {z.track_trace}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-right">
                      {z.aantal_colli ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-right">
                      {z.totaal_gewicht_kg != null
                        ? `${z.totaal_gewicht_kg} kg`
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/logistiek/${z.zending_nr}/printset`}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Verzendset printen voor ${z.zending_nr}`}
                        title="Verzendset printen (stickers + pakbon)"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      >
                        <Printer size={14} />
                      </Link>
                    </td>
                  </tr>
                )
                })}
              </tbody>
            ))}
          </table>
        )}
      </div>
      {/* Helper-text bij tabel */}
      <div className="mt-4 text-xs text-slate-400">
        Tip: lijst ververst elke 30 seconden. Klik op een rij voor details + transportorders.
      </div>
      {/* Vervoerder-registry-debug-info: aantal beschikbare codes (zodat lint geen unused warning geeft) */}
      <div className="sr-only">{Object.keys(VERVOERDER_REGISTRY).length} vervoerders bekend</div>
    </>
  )
}
