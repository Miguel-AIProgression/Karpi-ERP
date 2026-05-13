import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useLeverancierDetail, LeverancierFormDialog, LeverancierStatsCard } from '@/modules/inkoop'

export function LeverancierDetailPage() {
  const { id } = useParams()
  const leverancierId = id ? Number(id) : undefined
  const { data: leverancier, isLoading } = useLeverancierDetail(leverancierId)
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

        {leverancierId !== undefined && <LeverancierStatsCard leverancierId={leverancierId} />}
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
