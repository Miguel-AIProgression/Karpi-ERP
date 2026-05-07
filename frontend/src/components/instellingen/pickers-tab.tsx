import { useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { useMedewerkers } from '@/hooks/use-medewerkers'
import { PickerFormDialog } from './picker-form-dialog'
import type { Medewerker } from '@/lib/supabase/queries/medewerkers'

export function PickersTab() {
  const { data: pickers, isLoading } = useMedewerkers('picker')
  const [showCreate, setShowCreate] = useState(false)
  const [editPicker, setEditPicker] = useState<Medewerker | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {pickers?.length ?? 0} pickers — verschijnen in de dropdown bij start/voltooi pickronde.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
        >
          <Plus size={16} />
          Picker toevoegen
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Laden…</div>
      ) : !pickers || pickers.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500 bg-slate-50 rounded-[var(--radius-sm)] border border-slate-200">
          Nog geen pickers. Klik op <strong>Picker toevoegen</strong> om te beginnen.
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Naam</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pickers.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{p.naam}</td>
                  <td className="px-4 py-2">
                    {p.actief ? (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-50 text-emerald-700">
                        Actief
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-500">
                        Inactief
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setEditPicker(p)}
                      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
                    >
                      <Pencil size={14} />
                      Bewerken
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <PickerFormDialog onClose={() => setShowCreate(false)} />}
      {editPicker && (
        <PickerFormDialog picker={editPicker} onClose={() => setEditPicker(null)} />
      )}
    </div>
  )
}
