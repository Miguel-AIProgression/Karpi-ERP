import { useState } from 'react'
import { Clock } from 'lucide-react'
import { useConfectieWerktijden, useUpdateConfectieWerktijd } from '@/hooks/use-confectie-planning'
import type { ConfectieWerktijd } from '@/lib/supabase/queries/confectie-planning'

export function ConfectieTijdenConfig() {
  const [open, setOpen] = useState(false)
  const { data: werktijden, isLoading } = useConfectieWerktijden()
  const update = useUpdateConfectieWerktijd()

  const totaal = werktijden?.length ?? 0
  const actief = werktijden?.filter((w) => w.actief).length ?? 0

  function patch(type: string, velden: Partial<Pick<ConfectieWerktijd, 'minuten_per_meter' | 'wisseltijd_minuten' | 'actief'>>) {
    update.mutate({ type_bewerking: type, velden })
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4 mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
      >
        <Clock size={16} />
        Confectietijden per type {open ? '▾' : '▸'}
        <span className="text-xs font-normal text-slate-500 ml-2">
          {actief} van {totaal} types actief
        </span>
      </button>
      {open && (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-sm)] border border-slate-200">
          {isLoading || !werktijden ? (
            <p className="p-4 text-sm text-slate-400 text-center">Laden...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 px-3">Type bewerking</th>
                  <th className="py-2 px-3 w-40">Minuten / meter</th>
                  <th className="py-2 px-3 w-40">Wisseltijd (min)</th>
                  <th className="py-2 px-3 w-24">Actief</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {werktijden.map((w) => (
                  <tr key={w.type_bewerking} className="hover:bg-slate-50">
                    <td className="py-2 px-3 capitalize text-slate-700">{w.type_bewerking}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue={w.minuten_per_meter}
                        onBlur={(e) => {
                          const val = Number(e.target.value)
                          if (!Number.isNaN(val) && val !== Number(w.minuten_per_meter)) {
                            patch(w.type_bewerking, { minuten_per_meter: val })
                          }
                        }}
                        className="w-28 px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        defaultValue={w.wisseltijd_minuten}
                        onBlur={(e) => {
                          const val = Number(e.target.value)
                          if (!Number.isNaN(val) && val !== w.wisseltijd_minuten) {
                            patch(w.type_bewerking, { wisseltijd_minuten: Math.round(val) })
                          }
                        }}
                        className="w-28 px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={w.actief}
                        onChange={(e) => patch(w.type_bewerking, { actief: e.target.checked })}
                        className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400 cursor-pointer"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
