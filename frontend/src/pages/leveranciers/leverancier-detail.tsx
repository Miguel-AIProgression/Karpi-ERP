import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useLeverancierDetail } from '@/hooks/use-leveranciers'
import { useInkooporders } from '@/hooks/use-inkooporders'
import { LeverancierFormDialog } from '@/components/leveranciers/leverancier-form-dialog'
import { InkooporderStatusBadge } from '@/components/inkooporders/inkooporder-status-badge'

function formatDatum(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatMeters(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

export function LeverancierDetailPage() {
  const { id } = useParams()
  const leverancierId = id ? Number(id) : undefined
  const { data: leverancier, isLoading } = useLeverancierDetail(leverancierId)
  const { data: orders = [] } = useInkooporders({
    leverancier_id: leverancierId,
    alleen_open: true,
  })
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) {
    return <div className="p-12 text-center text-slate-400">Leverancier laden…</div>
  }
  if (!leverancier) {
    return <div className="p-12 text-center text-slate-400">Leverancier niet gevonden</div>
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/leveranciers"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={14} />
          Leveranciers
        </Link>
      </div>

      <PageHeader
        title={leverancier.naam}
        description={`Leverancier ${leverancier.leverancier_nr ?? '-'}`}
        actions={
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-[var(--radius-sm)] text-sm font-medium hover:bg-slate-50"
          >
            <Pencil size={16} />
            Bewerken
          </button>
        }
      />

      <div className="grid md:grid-cols-2 gap-5">
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-slate-400" />
            <h2 className="font-medium">Gegevens</h2>
          </div>
          <dl className="space-y-2 text-sm">
            <Rij label="Naam" value={leverancier.naam} />
            <Rij label="Woonplaats" value={leverancier.woonplaats} />
            <Rij label="Adres" value={leverancier.adres} />
            <Rij label="Postcode" value={leverancier.postcode} />
            <Rij label="Land" value={leverancier.land} />
            <Rij label="Contact" value={leverancier.contactpersoon} />
            <Rij label="Telefoon" value={leverancier.telefoon} />
            <Rij label="Email" value={leverancier.email} />
            <Rij label="Betaalconditie" value={leverancier.betaalconditie} />
            <Rij label="Status" value={leverancier.actief ? 'Actief' : 'Inactief'} />
          </dl>
        </section>

        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <h2 className="font-medium mb-4">Openstaande inkooporders ({orders.length})</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-slate-400">Geen openstaande orders</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left pb-2 font-medium">Ordernr</th>
                  <th className="text-left pb-2 font-medium">Leverweek</th>
                  <th className="text-right pb-2 font-medium">Openstaand</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2">
                      <Link
                        to={`/inkoop/${o.id}`}
                        className="text-terracotta-600 hover:text-terracotta-700"
                      >
                        {o.inkooporder_nr}
                      </Link>
                      {o.oud_inkooporder_nr && (
                        <span className="ml-2 text-xs text-slate-400">
                          ({o.oud_inkooporder_nr})
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-600">
                      {o.leverweek ?? formatDatum(o.verwacht_datum)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMeters(o.totaal_te_leveren_m)}
                    </td>
                    <td className="py-2">
                      <InkooporderStatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {editOpen && (
        <LeverancierFormDialog leverancier={leverancier} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}

function Rij({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-4">
      <dt className="w-32 text-slate-500">{label}</dt>
      <dd className="flex-1 text-slate-800">{value || <span className="text-slate-400">-</span>}</dd>
    </div>
  )
}
