// frontend/src/modules/magazijn/pages/pick-problemen.tsx
import { Link } from 'react-router-dom'
import { AlertCircle, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { usePickProblemen } from '../hooks/use-pickronde'

export function PickProblemenPage() {
  const { data: problemen = [], isLoading } = usePickProblemen()

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <AlertCircle size={22} className="text-rose-500" />
            Pick-problemen
          </span>
        }
        description={`${problemen.length} colli's gemarkeerd als 'niet gevonden' tijdens lopende Pickrondes`}
      />

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Laden...
        </div>
      ) : problemen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-500">
          Geen openstaande pick-problemen.
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="py-2 px-3 font-medium">Zending</th>
                <th className="py-2 px-3 font-medium">Order</th>
                <th className="py-2 px-3 font-medium">Klant</th>
                <th className="py-2 px-3 font-medium">Colli-omschrijving</th>
                <th className="py-2 px-3 font-medium">Opmerking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {problemen.map((p) => (
                <tr key={p.colli_id} className="hover:bg-slate-50">
                  <td className="py-2 px-3">
                    <Link
                      to={`/logistiek/${p.zending_nr}/printset`}
                      className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline"
                    >
                      {p.zending_nr}
                      <ExternalLink size={11} />
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-slate-600">{p.order_nr}</td>
                  <td className="py-2 px-3">{p.klant_naam ?? '—'}</td>
                  <td className="py-2 px-3 text-slate-600">
                    {p.omschrijving_snapshot ?? '—'}
                  </td>
                  <td className="py-2 px-3 text-rose-600 text-xs">
                    {p.pick_opmerking ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
