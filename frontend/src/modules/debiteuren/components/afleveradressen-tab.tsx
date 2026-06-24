import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { Afleveradres } from '../queries/debiteuren'
import { useAfleveradresMutation } from '../hooks/use-debiteuren'
import { AfleveradresDialog } from './afleveradres-dialog'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  debiteurNr: number
  adressen?: Afleveradres[]
}

export function AfleveradressenTab({ debiteurNr, adressen }: Props) {
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<Afleveradres | null>(null)
  const { save, remove } = useAfleveradresMutation(debiteurNr)
  // Externe vertegenwoordiger (mig 489): read-only — geen toevoegen/bewerken/verwijderen.
  const { isExternRep } = useAuth()

  function openNew() {
    setEditing(null)
    setShowDialog(true)
  }

  function openEdit(a: Afleveradres) {
    setEditing(a)
    setShowDialog(true)
  }

  async function handleDelete(a: Afleveradres) {
    if (!confirm(`Afleveradres "${a.naam}" verwijderen?`)) return
    await remove.mutateAsync(a.id)
  }

  return (
    <div>
      {!isExternRep && (
        <div className="px-5 py-3 flex justify-end border-b border-slate-100">
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Toevoegen
          </button>
        </div>
      )}

      {!adressen || adressen.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">Geen afleveradressen</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {adressen.map((a) => (
            <div key={a.id} className="px-5 py-3 flex items-start justify-between group">
              <div className="text-sm">
                <span className="text-slate-400 mr-2">#{a.adres_nr}</span>
                <span className="font-medium">{a.naam}</span>
                {a.adres && (
                  <span className="text-slate-500">
                    {' '}
                    — {a.adres}, {a.postcode} {a.plaats}
                    {a.land && a.land !== 'Nederland' ? `, ${a.land}` : ''}
                  </span>
                )}
                {(a.telefoon || a.email) && (
                  <div className="text-slate-400 mt-0.5 ml-6">
                    {a.telefoon && <span>{a.telefoon}</span>}
                    {a.telefoon && a.email && <span className="mx-1">·</span>}
                    {a.email && <span>{a.email}</span>}
                  </div>
                )}
                {a.gln_afleveradres && (
                  <div className="text-slate-400 mt-0.5 ml-6 text-xs">GLN {a.gln_afleveradres}</div>
                )}
              </div>
              {!isExternRep && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(a)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(a)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showDialog && !isExternRep && (
        <AfleveradresDialog
          initial={editing ?? undefined}
          onSave={(data) => save.mutateAsync(data)}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  )
}
