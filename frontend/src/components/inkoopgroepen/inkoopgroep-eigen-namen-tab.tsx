import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  useDeleteKlanteigenNaam,
  useKlanteigenVoorInkoopgroep,
} from '@/modules/debiteuren/hooks/use-klanteigen-namen'
import { KlanteigenNaamDialog } from '@/modules/debiteuren/components/klanteigen-naam-dialog'
import type { KlanteigenVoorInkoopgroepRow } from '@/modules/debiteuren'

interface Props {
  inkoopgroepCode: string
  inkoopgroepNaam: string
}

export function InkoopgroepEigenNamenTab({ inkoopgroepCode, inkoopgroepNaam }: Props) {
  const { data: namen, isLoading } = useKlanteigenVoorInkoopgroep(inkoopgroepCode)
  const del = useDeleteKlanteigenNaam()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<KlanteigenVoorInkoopgroepRow | null>(null)

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (row: KlanteigenVoorInkoopgroepRow) => {
    setEditing(row)
    setDialogOpen(true)
  }
  const handleDelete = async (row: KlanteigenVoorInkoopgroepRow) => {
    const label = row.kleur_code ? `${row.kwaliteit_code} kleur ${row.kleur_code}` : row.kwaliteit_code
    if (!confirm(`Eigen benaming voor ${label} ("${row.benaming}") verwijderen voor ${inkoopgroepNaam}?`)) return
    await del.mutateAsync(row.id)
  }

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-medium text-slate-700">Eigen benamingen</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Geldt voor alle leden van {inkoopgroepNaam}, tenzij een lid een eigen klant-specifieke benaming heeft.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
        >
          <Plus size={14} />
          Toevoegen
        </button>
      </div>

      {!namen || namen.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">
          Nog geen eigen benamingen voor deze inkoopgroep — klik op "Toevoegen".
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium text-slate-600 w-24">Kwaliteit</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600 w-24">Kleur</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Eigen benaming</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Omschrijving</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600 w-48">Leverancier</th>
              <th className="px-4 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {namen.map((n) => (
              <tr key={n.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{n.kwaliteit_code}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                  {n.kleur_code ?? <span className="italic text-slate-400">alle</span>}
                </td>
                <td className="px-4 py-2.5 font-medium">{n.benaming}</td>
                <td className="px-4 py-2.5 text-slate-500">{n.omschrijving ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{n.leverancier ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => openEdit(n)}
                      className="text-slate-400 hover:text-slate-700"
                      title="Bewerken"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(n)}
                      className="text-slate-400 hover:text-rose-600"
                      title="Verwijderen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialogOpen && (
        <KlanteigenNaamDialog
          inkoopgroepCode={inkoopgroepCode}
          initial={
            editing
              ? {
                  id: editing.id,
                  kwaliteit_code: editing.kwaliteit_code,
                  kleur_code: editing.kleur_code,
                  benaming: editing.benaming,
                  omschrijving: editing.omschrijving,
                  leverancier: editing.leverancier,
                }
              : undefined
          }
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}
