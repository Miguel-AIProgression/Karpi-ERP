import { useState } from 'react'
import { Plus, Pencil, Trash2, Shapes } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useAlleVormen, useDeleteVorm } from '../hooks/use-maatwerk-instellingen'
import { VormFormDialog } from '../components/vorm-form-dialog'
import { formatNumber } from '@/lib/utils/formatters'
import type { MaatwerkVormRow } from '@/modules/maatwerk'

const AFMETING_LABEL: Record<MaatwerkVormRow['afmeting_type'], string> = {
  lengte_breedte: 'Lengte × Breedte',
  diameter: 'Diameter',
}

export function VormenInstellingenPage() {
  const { data: vormen, isLoading } = useAlleVormen()
  const deleteMut = useDeleteVorm()
  const [showCreate, setShowCreate] = useState(false)
  const [editVorm, setEditVorm] = useState<MaatwerkVormRow | null>(null)

  const nextVolgorde = (vormen ?? []).reduce((max, v) => Math.max(max, v.volgorde), 0) + 10

  const handleDelete = async (vorm: MaatwerkVormRow) => {
    if (!confirm(`Vorm "${vorm.naam}" definitief verwijderen?\n\nLet op: dit kan FK-fouten geven als producten al naar deze vorm verwijzen. Overweeg om de vorm op inactief te zetten in plaats van verwijderen.`)) {
      return
    }
    try {
      await deleteMut.mutateAsync(vorm.id)
    } catch (err) {
      alert(`Verwijderen mislukt: ${err instanceof Error ? err.message : 'onbekende fout'}`)
    }
  }

  return (
    <>
      <PageHeader
        title="Vormen"
        description={`${vormen?.length ?? 0} vormen — beschikbaar bij maatwerk-orders. Vormen bepalen de toeslag en het afmeting-type.`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Nieuwe vorm
          </button>
        }
      />

      {isLoading ? (
        <div className="text-slate-400">Laden...</div>
      ) : !vormen || vormen.length === 0 ? (
        <div className="text-slate-400 flex items-center gap-2">
          <Shapes size={18} />
          Nog geen vormen gedefinieerd
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-16">#</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-44">Code</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Naam</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-40">Afmeting-type</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-28">Toeslag</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-28">Snijtijd</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Status</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {vormen.map((v) => (
                <tr
                  key={v.id}
                  className={`border-b border-slate-50 hover:bg-slate-50 ${!v.actief ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums">{v.volgorde}</td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {v.code}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{v.naam}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {AFMETING_LABEL[v.afmeting_type] ?? v.afmeting_type}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {v.toeslag > 0 ? `€ ${formatNumber(v.toeslag, 2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatNumber(v.snijtijd_minuten, 1)} min
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {v.actief ? (
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
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditVorm(v)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:border-terracotta-300 hover:text-terracotta-600"
                        title="Bewerken"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(v)}
                        disabled={deleteMut.isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                        title="Verwijderen"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 max-w-2xl">
        Vormen zijn gekoppeld aan producten via{' '}
        <code className="px-1 bg-slate-100 rounded">producten.maatwerk_vorm_code</code>. De toeslag wordt
        automatisch toegepast in <code className="px-1 bg-slate-100 rounded">bereken_orderregel_prijs</code>{' '}
        (mig 191). Verwijder een vorm alleen als zeker is dat geen enkel product er nog naar verwijst —
        zet anders op inactief.
      </p>

      {showCreate && (
        <VormFormDialog defaultVolgorde={nextVolgorde} onClose={() => setShowCreate(false)} />
      )}
      {editVorm && <VormFormDialog vorm={editVorm} onClose={() => setEditVorm(null)} />}
    </>
  )
}
