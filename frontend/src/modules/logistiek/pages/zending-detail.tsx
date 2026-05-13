import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useZending, useVerstuurZendingOpnieuw } from '@/modules/logistiek/hooks/use-zendingen'
import { ZendingStatusBadge } from '@/modules/logistiek/components/zending-status-badge'
import { VervoerderTag } from '@/modules/logistiek/components/vervoerder-tag'
import {
  HstTransportorderCard,
  type HstTransportorderRow,
} from '@/modules/logistiek/components/hst-transportorder-card'

interface BundelOrder {
  id: number
  order_nr: string
  debiteur_nr: number
  debiteuren?: {
    debiteur_nr: number
    naam: string
  } | null
}

interface ZendingRegelRow {
  id: number
  order_regel_id: number | null
  artikelnr: string | null
  rol_id: number | null
  aantal: number
  order_regels?: {
    id: number
    order_id: number
    regelnummer: number | null
    omschrijving: string | null
  } | null
}

interface ZendingDetailShape {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  opmerkingen: string | null
  created_at: string
  orders: BundelOrder
  zending_orders?: Array<{
    order_id: number
    bundel_order: BundelOrder | null
  }>
  zending_regels: ZendingRegelRow[]
  hst_transportorders: HstTransportorderRow[]
}

export function ZendingDetailPage() {
  const { zending_nr } = useParams<{ zending_nr: string }>()
  const { data: zending, isLoading } = useZending(zending_nr)
  const retryMutation = useVerstuurZendingOpnieuw()

  if (isLoading) return <div className="p-8 text-slate-500">Laden…</div>
  if (!zending) return <div className="p-8 text-rose-600">Zending niet gevonden.</div>

  const z = zending as unknown as ZendingDetailShape

  // Mig 222: bundel-orders uit M2M `zending_orders`. Voor solo-zendingen zit
  // de primaire order ook in de M2M (backfill); fallback op `z.orders` als de
  // M2M leeg blijkt zodat oude rijen nog renderen.
  const bundelOrdersRaw = (z.zending_orders ?? [])
    .map((row) => row.bundel_order)
    .filter((o): o is BundelOrder => o != null)
  const bundelOrders: BundelOrder[] =
    bundelOrdersRaw.length > 0 ? bundelOrdersRaw : z.orders ? [z.orders] : []
  const bundelOrdersGesorteerd = [...bundelOrders].sort((a, b) =>
    a.order_nr.localeCompare(b.order_nr),
  )
  const isBundel = bundelOrdersGesorteerd.length > 1

  // Groepeer regels op bron-order via order_regels.order_id. Onbekende order
  // (legacy of corrupte rij) komt onder een aparte sleutel `null`.
  const regelsPerOrder = new Map<number | null, ZendingRegelRow[]>()
  for (const r of z.zending_regels ?? []) {
    const orderId = r.order_regels?.order_id ?? null
    const bestaand = regelsPerOrder.get(orderId) ?? []
    bestaand.push(r)
    regelsPerOrder.set(orderId, bestaand)
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/logistiek"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> Terug naar zendingen
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {z.zending_nr}
            <ZendingStatusBadge status={z.status} />
            <VervoerderTag code={z.vervoerder_code} showLeeg />
          </span>
        }
        description={
          bundelOrdersGesorteerd.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <span>{isBundel ? `Bundel van ${bundelOrdersGesorteerd.length} orders:` : 'Order'}</span>
              {bundelOrdersGesorteerd.map((o, i) => (
                <span key={o.id} className="inline-flex items-center">
                  <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                    {o.order_nr}
                  </Link>
                  {i < bundelOrdersGesorteerd.length - 1 ? <span>,</span> : null}
                </span>
              ))}
            </span>
          ) : null
        }
      />

      {/* Sectie 1 — zending-info */}
      <Section titel="Zending">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Field label="Verzenddatum">{z.verzenddatum ?? '—'}</Field>
          <Field label="Aantal colli">{z.aantal_colli ?? '—'}</Field>
          <Field label="Gewicht">{z.totaal_gewicht_kg != null ? `${z.totaal_gewicht_kg} kg` : '—'}</Field>
          <Field label="Track & Trace">
            <span className="font-mono text-xs">{z.track_trace ?? '—'}</span>
          </Field>
          <Field label="Afleveradres">
            {z.afl_naam}<br />
            {z.afl_adres}<br />
            {z.afl_postcode} {z.afl_plaats}{z.afl_land ? `, ${z.afl_land}` : ''}
          </Field>
          {z.opmerkingen && (
            <Field label="Opmerkingen">
              <span className="whitespace-pre-wrap">{z.opmerkingen}</span>
            </Field>
          )}
        </div>
      </Section>

      {/* Sectie 2 — order-koppeling (mig 222: kan een bundel zijn). */}
      <Section titel={isBundel ? `Orders (${bundelOrdersGesorteerd.length})` : 'Order'}>
        {bundelOrdersGesorteerd.length === 0 ? (
          <div className="text-sm text-slate-400">Geen order gekoppeld.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ordernummer</th>
                <th className="px-3 py-2 text-left font-medium">Klant</th>
                <th className="px-3 py-2 text-left font-medium">Debiteur-nr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bundelOrdersGesorteerd.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2">
                    <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                      {o.order_nr}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/klanten/${o.debiteur_nr}`} className="text-terracotta-600 hover:underline">
                      {o.debiteuren?.naam ?? `#${o.debiteur_nr}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{o.debiteur_nr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Sectie 3 — regels, gegroepeerd per bron-order bij bundels. */}
      <Section titel={`Zending-regels (${z.zending_regels?.length ?? 0})`}>
        {!z.zending_regels || z.zending_regels.length === 0 ? (
          <div className="text-sm text-slate-400">Geen regels.</div>
        ) : (
          <div className="space-y-4">
            {bundelOrdersGesorteerd.map((o) => {
              const regels = regelsPerOrder.get(o.id) ?? []
              if (regels.length === 0 && !isBundel) {
                // Solo-zending zonder order-match — val terug op alle regels.
                return (
                  <RegelTabel key={o.id} titel={null} regels={z.zending_regels} />
                )
              }
              if (regels.length === 0) return null
              return (
                <div key={o.id}>
                  {isBundel && (
                    <div className="text-xs font-semibold text-slate-600 mb-1.5">
                      <Link to={`/orders/${o.id}`} className="text-terracotta-600 hover:underline">
                        {o.order_nr}
                      </Link>
                    </div>
                  )}
                  <RegelTabel titel={null} regels={regels} />
                </div>
              )
            })}
            {(() => {
              const wezen = regelsPerOrder.get(null) ?? []
              if (wezen.length === 0) return null
              return (
                <div>
                  <div className="text-xs font-semibold text-amber-600 mb-1.5">
                    Regels zonder bron-order
                  </div>
                  <RegelTabel titel={null} regels={wezen} />
                </div>
              )
            })()}
          </div>
        )}
      </Section>

      {/* Sectie 4 — HST-transportorders-historie */}
      <Section titel={`HST-transportorders (${z.hst_transportorders?.length ?? 0})`}>
        {!z.hst_transportorders || z.hst_transportorders.length === 0 ? (
          <div className="text-sm text-slate-400">
            Nog geen transportorder. Wordt automatisch aangemaakt door de trigger zodra de
            klant een vervoerder heeft.
          </div>
        ) : (
          <div className="space-y-4">
            {z.hst_transportorders.map((t) => (
              <HstTransportorderCard
                key={t.id}
                row={t}
                onRetry={() => retryMutation.mutate(t.id)}
                retryBusy={retryMutation.isPending && retryMutation.variables === t.id}
              />
            ))}
          </div>
        )}
        {retryMutation.isError && (
          <div className="mt-3 text-xs text-rose-600">
            Retry mislukt: {String((retryMutation.error as Error).message)}
          </div>
        )}
      </Section>
    </>
  )
}

function RegelTabel({
  titel,
  regels,
}: {
  titel: string | null
  regels: ZendingRegelRow[]
}) {
  return (
    <div>
      {titel && <div className="text-xs font-semibold text-slate-600 mb-1.5">{titel}</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Regel</th>
            <th className="px-3 py-2 text-left font-medium">Artikelnr</th>
            <th className="px-3 py-2 text-left font-medium">Omschrijving</th>
            <th className="px-3 py-2 text-left font-medium">Rol-id</th>
            <th className="px-3 py-2 text-right font-medium">Aantal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {regels.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-slate-600">
                {r.order_regels?.regelnummer ?? r.order_regel_id ?? '—'}
              </td>
              <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                {r.artikelnr ?? '—'}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {r.order_regels?.omschrijving ?? '—'}
              </td>
              <td className="px-3 py-2 text-slate-600">{r.rol_id ?? '—'}</td>
              <td className="px-3 py-2 text-right text-slate-700">{r.aantal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{titel}</h3>
      {children}
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
