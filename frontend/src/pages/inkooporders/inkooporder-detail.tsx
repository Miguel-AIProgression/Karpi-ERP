import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Ban } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import {
  useInkooporderDetail,
  useUpdateInkooporderStatus,
} from '@/hooks/use-inkooporders'
import { InkooporderStatusBadge } from '@/components/inkooporders/inkooporder-status-badge'
import { OntvangstBoekenDialog } from '@/components/inkooporders/ontvangst-boeken-dialog'
import { VoorraadOntvangstDialog } from '@/components/inkooporders/voorraad-ontvangst-dialog'
import type { InkooporderRegel } from '@/lib/supabase/queries/inkooporders'

function formatAantal(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

function eenheidKort(eenheid: 'm' | 'stuks'): string {
  return eenheid === 'stuks' ? 'st.' : 'm²'
}

function formatDatum(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatGeld(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return `€ ${value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InkooporderDetailPage() {
  const { id } = useParams()
  const orderId = id ? Number(id) : undefined
  const { data, isLoading, error } = useInkooporderDetail(orderId)
  const updateStatus = useUpdateInkooporderStatus()
  const [ontvangstRegel, setOntvangstRegel] = useState<InkooporderRegel | null>(null)

  if (isLoading) {
    return <div className="p-12 text-center text-slate-400">Inkooporder laden…</div>
  }
  if (error) {
    return (
      <div className="p-12 text-center">
        <div className="text-red-600 font-medium mb-2">Fout bij ophalen inkooporder {orderId}</div>
        <pre className="text-xs text-slate-500 bg-slate-50 p-3 rounded max-w-xl mx-auto text-left overflow-auto">
          {error instanceof Error ? error.message : JSON.stringify(error, null, 2)}
        </pre>
      </div>
    )
  }
  if (!data) {
    return <div className="p-12 text-center text-slate-400">Inkooporder {orderId} niet gevonden</div>
  }

  const { order, regels, context } = data
  const totaalM2 = regels.filter((r) => r.eenheid === 'm').reduce((s, r) => s + Number(r.te_leveren_m ?? 0), 0)
  const totaalStuks = regels.filter((r) => r.eenheid === 'stuks').reduce((s, r) => s + Number(r.te_leveren_m ?? 0), 0)
  const totaalLabel = [
    totaalM2 > 0 ? `${formatAantal(totaalM2)} m²` : null,
    totaalStuks > 0 ? `${formatAantal(totaalStuks)} st.` : null,
  ].filter(Boolean).join(' + ') || '0'
  const kanAnnuleren = order.status === 'Concept' || order.status === 'Besteld'

  return (
    <>
      <div className="mb-4">
        <Link
          to="/inkoop"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={14} />
          Inkooporders
        </Link>
      </div>

      <PageHeader
        title={order.inkooporder_nr}
        description={
          order.oud_inkooporder_nr
            ? `Origineel ordernummer: ${order.oud_inkooporder_nr}`
            : 'Handmatig aangemaakt'
        }
        actions={
          <div className="flex items-center gap-2">
            <InkooporderStatusBadge status={order.status} />
            {kanAnnuleren && (
              <button
                onClick={() =>
                  updateStatus.mutate({ id: order.id, status: 'Geannuleerd' })
                }
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-[var(--radius-sm)]"
              >
                <Ban size={14} />
                Annuleren
              </button>
            )}
          </div>
        }
      />

      <div className="grid md:grid-cols-3 gap-5 mb-6">
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 md:col-span-1">
          <h2 className="font-medium mb-4">Gegevens</h2>
          <dl className="space-y-2 text-sm">
            <Rij
              label="Leverancier"
              value={
                order.leverancier ? (
                  <Link
                    to={`/leveranciers/${order.leverancier.id}`}
                    className="text-terracotta-600 hover:text-terracotta-700"
                  >
                    {order.leverancier.naam}
                  </Link>
                ) : (
                  '-'
                )
              }
            />
            <Rij label="Besteldatum" value={formatDatum(order.besteldatum)} />
            <Rij label="Leverweek" value={order.leverweek ?? '-'} />
            <Rij label="Verwacht" value={formatDatum(order.verwacht_datum)} />
            <Rij label="Bron" value={order.bron} />
            {order.opmerkingen && <Rij label="Opmerking" value={order.opmerkingen} />}
          </dl>
        </section>

        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Regels ({regels.length})</h2>
            <span className="text-sm text-slate-500">
              Nog te leveren: <strong>{totaalLabel}</strong>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left pb-2 font-medium w-10">#</th>
                <th className="text-left pb-2 font-medium">Artikel</th>
                <th className="text-right pb-2 font-medium">Prijs</th>
                <th className="text-right pb-2 font-medium">Besteld</th>
                <th className="text-right pb-2 font-medium">Geleverd</th>
                <th className="text-right pb-2 font-medium">Te leveren</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {regels.map((r) => {
                const eh = eenheidKort(r.eenheid)
                return (
                  <tr key={r.id}>
                    <td className="py-2 text-slate-400 align-top">{r.regelnummer}</td>
                    <td className="py-2">
                      <div className="font-medium text-slate-800">
                        {r.karpi_code ?? r.artikelnr ?? '-'}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {r.eenheid === 'm' ? 'rol' : 'vast'}
                        </span>
                      </div>
                      {r.artikel_omschrijving && (
                        <div className="text-xs text-slate-500">{r.artikel_omschrijving}</div>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-600">
                      {formatGeld(r.inkoopprijs_eur)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatAantal(r.besteld_m)} <span className="text-xs text-slate-400">{eh}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatAantal(r.geleverd_m)} <span className="text-xs text-slate-400">{eh}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.te_leveren_m > 0 ? (
                        <span className="font-medium text-slate-800">
                          {formatAantal(r.te_leveren_m)} <span className="text-xs text-slate-500 font-normal">{eh}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {r.te_leveren_m > 0 && (
                        <button
                          onClick={() => setOntvangstRegel(r)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-[var(--radius-sm)]"
                        >
                          <PackageCheck size={13} />
                          Ontvangst
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      </div>

      {ontvangstRegel && ontvangstRegel.eenheid === 'm' && (
        <OntvangstBoekenDialog
          regel={ontvangstRegel}
          inkooporderNr={order.inkooporder_nr}
          breedteCm={
            ontvangstRegel.artikelnr ? context.get(ontvangstRegel.artikelnr)?.breedte_cm ?? null : null
          }
          onClose={() => setOntvangstRegel(null)}
        />
      )}
      {ontvangstRegel && ontvangstRegel.eenheid === 'stuks' && (
        <VoorraadOntvangstDialog
          regel={ontvangstRegel}
          inkooporderNr={order.inkooporder_nr}
          onClose={() => setOntvangstRegel(null)}
        />
      )}
    </>
  )
}

function Rij({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-24 text-slate-500">{label}</dt>
      <dd className="flex-1 text-slate-800">{value || <span className="text-slate-400">-</span>}</dd>
    </div>
  )
}
