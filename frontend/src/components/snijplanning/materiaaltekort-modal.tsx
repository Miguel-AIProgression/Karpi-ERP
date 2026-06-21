import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X, PackageX } from 'lucide-react'
import { formatDate } from '@/lib/utils/formatters'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import type { MasterPlanningRij } from '@/pages/snijplanning/master-planning-overview'

interface Props {
  rijen: MasterPlanningRij[]
  onClose: () => void
}

export function MateriaaltekortModal({ rijen, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[80vh] bg-white rounded-[var(--radius)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <PackageX size={18} className="text-purple-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Materiaaltekort</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {rijen.length} {rijen.length === 1 ? 'regel' : 'regels'} zonder rol én zonder inkoop — echt materiaaltekort
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Order</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Klant</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Kwaliteit · Kleur</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Afmeting</th>
                <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Aantal</th>
                <th className="px-4 py-2 text-left font-medium whitespace-nowrap">Leverdatum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rijen.map((r) => {
                const vorm = getVormDisplay(r.maatwerk_vorm)
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link to={`/orders/${r.order_id}`} className="font-medium text-terracotta-600 hover:underline">
                        {r.order_nr}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{r.klant_naam}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">{r.kwaliteit_code} · {r.kleur_code}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                      {r.snij_lengte_cm}×{r.snij_breedte_cm} cm
                      {vorm.label && <span className="block text-xs text-slate-400">{vorm.label}</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-700">{r.orderaantal}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">
                      {r.afleverdatum ? formatDate(r.afleverdatum) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
