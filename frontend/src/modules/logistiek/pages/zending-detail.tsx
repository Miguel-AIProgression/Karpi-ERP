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

interface ZendingRegelRow {
  id: number
  order_regel_id: number | null
  artikelnr: string | null
  rol_id: number | null
  aantal: number
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
  orders: {
    id: number
    order_nr: string
    debiteur_nr: number
    debiteuren?: {
      debiteur_nr: number
      naam: string
    } | null
  }
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
          z.orders ? (
            <>
              Order&nbsp;
              <Link to={`/orders/${z.orders.id}`} className="text-terracotta-600 hover:underline">
                {z.orders.order_nr}
              </Link>
            </>
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

      {/* Sectie 2 — order-koppeling */}
      <Section titel="Order">
        {z.orders ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Field label="Ordernummer">
              <Link to={`/orders/${z.orders.id}`} className="text-terracotta-600 hover:underline">
                {z.orders.order_nr}
              </Link>
            </Field>
            <Field label="Klant">
              <Link to={`/klanten/${z.orders.debiteur_nr}`} className="text-terracotta-600 hover:underline">
                {z.orders.debiteuren?.naam ?? `#${z.orders.debiteur_nr}`}
              </Link>
            </Field>
            <Field label="Debiteur-nr">{z.orders.debiteur_nr}</Field>
          </div>
        ) : (
          <div className="text-sm text-slate-400">Geen order gekoppeld.</div>
        )}
      </Section>

      {/* Sectie 3 — regels */}
      <Section titel={`Zending-regels (${z.zending_regels?.length ?? 0})`}>
        {!z.zending_regels || z.zending_regels.length === 0 ? (
          <div className="text-sm text-slate-400">Geen regels.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order-regel</th>
                <th className="px-3 py-2 text-left font-medium">Artikelnr</th>
                <th className="px-3 py-2 text-left font-medium">Rol-id</th>
                <th className="px-3 py-2 text-right font-medium">Aantal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {z.zending_regels.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-slate-600">{r.order_regel_id ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 font-mono text-xs">{r.artikelnr ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{r.rol_id ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{r.aantal}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
