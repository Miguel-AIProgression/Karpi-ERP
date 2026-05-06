import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useInkoopgroepen } from '@/hooks/use-inkoopgroepen'
import { InkoopgroepFormDialog } from '@/components/inkoopgroepen/inkoopgroep-form-dialog'
import { InkoopgroepAddDebiteurDialog } from '@/components/inkoopgroepen/inkoopgroep-add-debiteur-dialog'

export function InkoopgroepenOverviewPage() {
  const { data: groepen, isLoading } = useInkoopgroepen()
  const [showCreate, setShowCreate] = useState(false)
  const [addDebTo, setAddDebTo] = useState<{ code: string; naam: string } | null>(null)

  return (
    <>
      <PageHeader
        title="Inkoopgroepen"
        description={`${groepen?.length ?? 0} groepen — debiteuren die als groep inkopen`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Nieuwe groep
          </button>
        }
      />

      {isLoading ? (
        <div className="text-slate-400">Laden...</div>
      ) : !groepen || groepen.length === 0 ? (
        <div className="text-slate-400">Nog geen inkoopgroepen</div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-32">Code</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Naam</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-28">Leden</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Status</th>
                <th className="px-4 py-2 w-44"></th>
              </tr>
            </thead>
            <tbody>
              {groepen.map((g) => (
                <tr
                  key={g.code}
                  className={`border-b border-slate-50 hover:bg-slate-50 ${!g.actief ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/inkoopgroepen/${g.code}`}
                      className="text-terracotta-500 hover:underline font-medium"
                    >
                      {g.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{g.naam}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Users size={13} className="text-slate-400" />
                      {g.aantal_leden}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {g.actief ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        Actief
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                        Inactief
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setAddDebTo({ code: g.code, naam: g.naam })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:border-terracotta-300 hover:text-terracotta-600"
                      title="Debiteur aan deze groep toevoegen"
                    >
                      <UserPlus size={12} />
                      Debiteur
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <InkoopgroepFormDialog onClose={() => setShowCreate(false)} />}
      {addDebTo && (
        <InkoopgroepAddDebiteurDialog
          inkoopgroepCode={addDebTo.code}
          inkoopgroepNaam={addDebTo.naam}
          onClose={() => setAddDebTo(null)}
        />
      )}
    </>
  )
}
