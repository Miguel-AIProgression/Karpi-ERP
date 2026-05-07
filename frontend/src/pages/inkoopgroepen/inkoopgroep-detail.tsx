import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  useInkoopgroepDetail,
  useInkoopgroepLeden,
  useSetDebiteurInkoopgroep,
} from '@/hooks/use-inkoopgroepen'
import { InkoopgroepAddDebiteurDialog } from '@/components/inkoopgroepen/inkoopgroep-add-debiteur-dialog'
import { InkoopgroepEigenNamenTab } from '@/components/inkoopgroepen/inkoopgroep-eigen-namen-tab'

type Tab = 'leden' | 'eigennamen'

export function InkoopgroepDetailPage() {
  const { code } = useParams<{ code: string }>()
  const [showAdd, setShowAdd] = useState(false)
  const [removeBusy, setRemoveBusy] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('leden')

  const { data: groep, isLoading } = useInkoopgroepDetail(code)
  const { data: leden } = useInkoopgroepLeden(code)
  const removeMutation = useSetDebiteurInkoopgroep()

  if (isLoading) return <PageHeader title="Inkoopgroep laden..." />
  if (!groep) {
    return (
      <>
        <PageHeader title="Inkoopgroep niet gevonden" />
        <Link to="/inkoopgroepen" className="text-terracotta-500 hover:underline">
          Terug
        </Link>
      </>
    )
  }

  const handleRemove = async (debiteurNr: number) => {
    if (!confirm('Debiteur uit deze inkoopgroep halen?')) return
    setRemoveBusy(debiteurNr)
    try {
      await removeMutation.mutateAsync({ debiteurNr, code: null })
    } finally {
      setRemoveBusy(null)
    }
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/inkoopgroepen"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar inkoopgroepen
        </Link>
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{groep.naam}</h1>
            <div className="text-sm text-slate-400 mt-1">{groep.code}</div>
            {groep.omschrijving && (
              <div className="text-sm text-slate-600 mt-2">{groep.omschrijving}</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
              <Users size={16} className="text-slate-400" />
              {groep.aantal_leden} leden
            </span>
            {!groep.actief && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                Inactief
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-3 border-b border-slate-200">
        {([
          { key: 'leden', label: `Leden (${groep.aantal_leden})` },
          { key: 'eigennamen', label: 'Eigen benamingen' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-1 pb-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-terracotta-500 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'eigennamen' && (
        <InkoopgroepEigenNamenTab inkoopgroepCode={groep.code} inkoopgroepNaam={groep.naam} />
      )}

      {activeTab === 'leden' && (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="font-medium text-slate-700">Gekoppelde debiteuren</h2>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Debiteur toevoegen
          </button>
        </div>

        {!leden || leden.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">
            Nog geen debiteuren in deze inkoopgroep
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-24">#</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Naam</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-48">Plaats</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Status</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-20">Tier</th>
                <th className="px-4 py-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {leden.map((d) => (
                <tr key={d.debiteur_nr} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">
                    #{d.debiteur_nr}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/klanten/${d.debiteur_nr}`}
                      className="text-terracotta-500 hover:underline font-medium"
                    >
                      {d.naam}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{d.plaats ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <StatusBadge status={d.status} type="order" />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {d.tier ? <StatusBadge status={d.tier} type="tier" /> : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleRemove(d.debiteur_nr)}
                      disabled={removeBusy === d.debiteur_nr}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                      title="Uit groep verwijderen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      {showAdd && (
        <InkoopgroepAddDebiteurDialog
          inkoopgroepCode={groep.code}
          inkoopgroepNaam={groep.naam}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  )
}
