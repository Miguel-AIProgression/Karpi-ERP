import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import {
  useAfwerkingKleuren,
  useDeleteAfwerkingKleur,
  useUpsertAfwerkingKleur,
} from '@/hooks/use-afwerking-kleuren'
import type { AfwerkingKleurRow } from '@/lib/supabase/queries/afwerking-kleuren'
import { AfwerkingKleurKoppelingen } from './afwerking-kleur-koppelingen'

interface Props {
  afwerkingCode: string
  colSpan: number
}

export function AfwerkingKleurenSubmenu({ afwerkingCode, colSpan }: Props) {
  const { data: kleuren, isLoading } = useAfwerkingKleuren(afwerkingCode)
  const upsertMut = useUpsertAfwerkingKleur()
  const deleteMut = useDeleteAfwerkingKleur(afwerkingCode)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [expandedKoppelingenId, setExpandedKoppelingenId] = useState<number | null>(null)

  const nextVolgorde = (kleuren ?? []).reduce((m, r) => Math.max(m, r.volgorde), 0) + 10

  async function handleSave(row: Omit<AfwerkingKleurRow, 'id'> & { id?: number }) {
    setErrorMsg(null)
    try {
      await upsertMut.mutateAsync(row)
      setEditingId(null)
      setShowAdd(false)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Opslaan mislukt')
    }
  }

  async function handleDelete(row: AfwerkingKleurRow) {
    if (!confirm(`Kleur "${row.label}" verwijderen?\n\nLet op: als deze kleur ergens als default of op een orderregel staat, blokkeert de FK het verwijderen — gebruik dan "inactief" in plaats daarvan.`)) return
    setErrorMsg(null)
    try {
      await deleteMut.mutateAsync(row.id)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verwijderen mislukt')
    }
  }

  return (
    <tr className="bg-slate-50/60">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="ml-8 max-w-3xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Bandkleuren / labels onder {afwerkingCode}
            </div>
            <button
              onClick={() => { setShowAdd(true); setEditingId(null) }}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 bg-white text-slate-700 hover:border-terracotta-300 hover:text-terracotta-600"
            >
              <Plus size={12} />
              Nieuwe kleur
            </button>
          </div>

          {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}

          {isLoading ? (
            <div className="text-xs text-slate-400">Laden…</div>
          ) : (
            <div className="bg-white rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left px-3 py-1.5 font-medium text-slate-500 text-xs w-16">#</th>
                    <th className="text-left px-3 py-1.5 font-medium text-slate-500 text-xs">Label</th>
                    <th className="text-center px-3 py-1.5 font-medium text-slate-500 text-xs w-20">Status</th>
                    <th className="px-3 py-1.5 w-28"></th>
                  </tr>
                </thead>
                <tbody>
                  {(kleuren ?? []).map((row) => {
                    if (editingId === row.id) {
                      return (
                        <RowEditor
                          key={row.id}
                          initial={row}
                          afwerkingCode={afwerkingCode}
                          onCancel={() => setEditingId(null)}
                          onSave={handleSave}
                          saving={upsertMut.isPending}
                        />
                      )
                    }
                    const isExpanded = expandedKoppelingenId === row.id
                    return (
                      <Fragment key={row.id}>
                      <tr className={`border-b border-slate-50 hover:bg-slate-50 ${!row.actief ? 'opacity-60' : ''} ${isExpanded ? 'bg-terracotta-50/40' : ''}`}>
                        <td className="px-3 py-1.5 text-slate-400 tabular-nums text-xs">
                          <button
                            onClick={() => setExpandedKoppelingenId((cur) => (cur === row.id ? null : row.id))}
                            className="text-slate-400 hover:text-slate-600 mr-1 align-middle"
                            title={isExpanded ? 'Inklappen' : 'Toon gekoppelde producten'}
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                          {row.volgorde}
                        </td>
                        <td className="px-3 py-1.5 text-slate-800">{row.label}</td>
                        <td className="px-3 py-1.5 text-center">
                          {row.actief ? (
                            <span className="px-1.5 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">Actief</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">Inactief</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditingId(row.id); setShowAdd(false) }}
                              className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-terracotta-600"
                              title="Bewerken"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => handleDelete(row)}
                              disabled={deleteMut.isPending}
                              className="p-1 rounded text-slate-500 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
                              title="Verwijderen"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/40">
                          <td colSpan={4} className="px-6 py-3">
                            <AfwerkingKleurKoppelingen afwerkingKleurId={row.id} afwerkingCode={afwerkingCode} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                  {showAdd && (
                    <RowEditor
                      initial={{ id: undefined, afwerking_code: afwerkingCode, label: '', volgorde: nextVolgorde, actief: true }}
                      afwerkingCode={afwerkingCode}
                      onCancel={() => setShowAdd(false)}
                      onSave={handleSave}
                      saving={upsertMut.isPending}
                    />
                  )}
                  {!isLoading && (kleuren?.length ?? 0) === 0 && !showAdd && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-xs text-slate-400 italic">
                        Nog geen kleuren. Voeg er een toe met de knop hierboven.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

interface RowEditorProps {
  initial: Omit<AfwerkingKleurRow, 'id'> & { id?: number }
  afwerkingCode: string
  onCancel: () => void
  onSave: (row: Omit<AfwerkingKleurRow, 'id'> & { id?: number }) => void
  saving: boolean
}

function RowEditor({ initial, afwerkingCode, onCancel, onSave, saving }: RowEditorProps) {
  const [label, setLabel] = useState(initial.label)
  const [volgorde, setVolgorde] = useState(String(initial.volgorde))
  const [actief, setActief] = useState(initial.actief)

  function commit() {
    const v = Number(volgorde)
    if (!label.trim()) return
    onSave({
      id: initial.id,
      afwerking_code: afwerkingCode,
      label: label.trim(),
      volgorde: Number.isFinite(v) ? v : 0,
      actief,
    })
  }

  return (
    <tr className="border-b border-slate-50 bg-amber-50/40">
      <td className="px-3 py-1.5">
        <input
          type="number"
          value={volgorde}
          onChange={(e) => setVolgorde(e.target.value)}
          className="w-14 px-1.5 py-0.5 border border-slate-300 rounded text-xs text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
          placeholder="Bv. Piero Taupe 431"
          className="w-full px-2 py-0.5 border border-slate-300 rounded text-sm"
        />
      </td>
      <td className="px-3 py-1.5 text-center">
        <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
          <input type="checkbox" checked={actief} onChange={(e) => setActief(e.target.checked)} />
          <span className="text-slate-600">Actief</span>
        </label>
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={commit}
            disabled={saving || !label.trim()}
            className="p-1 rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
            title="Opslaan (Enter)"
          >
            <Check size={12} />
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            title="Annuleren (Esc)"
          >
            <X size={12} />
          </button>
        </div>
      </td>
    </tr>
  )
}
