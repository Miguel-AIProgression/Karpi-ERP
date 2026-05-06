import { Fragment, useState } from 'react'
import { Plus, Pencil, Trash2, Scissors, ChevronDown, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useAlleAfwerkingen, useDeleteAfwerking } from '@/hooks/use-afwerkingen'
import { AfwerkingFormDialog } from '@/components/instellingen/afwerking-form-dialog'
import { AfwerkingKleurenSubmenu } from '@/components/instellingen/afwerking-kleuren-submenu'
import { formatNumber } from '@/lib/utils/formatters'
import type { AfwerkingTypeRow } from '@/lib/supabase/queries/op-maat'

const COL_COUNT = 8

export function AfwerkingenInstellingenPage() {
  const { data: afwerkingen, isLoading } = useAlleAfwerkingen()
  const deleteMut = useDeleteAfwerking()
  const [showCreate, setShowCreate] = useState(false)
  const [editAfw, setEditAfw] = useState<AfwerkingTypeRow | null>(null)
  const [expandedCode, setExpandedCode] = useState<string | null>(null)

  const nextVolgorde = (afwerkingen ?? []).reduce((max, a) => Math.max(max, a.volgorde), 0) + 10

  const handleDelete = async (afw: AfwerkingTypeRow) => {
    if (!confirm(`Afwerking "${afw.code} — ${afw.naam}" definitief verwijderen?\n\nLet op: dit kan FK-fouten geven als orderregels al naar deze afwerking verwijzen. Overweeg om de afwerking op inactief te zetten.`)) {
      return
    }
    try {
      await deleteMut.mutateAsync(afw.id)
    } catch (err) {
      alert(`Verwijderen mislukt: ${err instanceof Error ? err.message : 'onbekende fout'}`)
    }
  }

  return (
    <>
      <PageHeader
        title="Afwerkingen"
        description={`${afwerkingen?.length ?? 0} afwerkingen — beschikbaar bij maatwerk-orders. Bepalen welke confectie-lane het werk krijgt.`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Nieuwe afwerking
          </button>
        }
      />

      {isLoading ? (
        <div className="text-slate-400">Laden...</div>
      ) : !afwerkingen || afwerkingen.length === 0 ? (
        <div className="text-slate-400 flex items-center gap-2">
          <Scissors size={18} />
          Nog geen afwerkingen gedefinieerd
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-16">#</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-20">Code</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Naam</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-44">Confectie-lane</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Bandkleur</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-28">Prijs/m</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Status</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {afwerkingen.map((a) => {
                const isExpanded = expandedCode === a.code
                const canExpand = a.heeft_band_kleur
                return (
                <Fragment key={a.id}>
                <tr
                  className={`border-b border-slate-50 hover:bg-slate-50 ${!a.actief ? 'opacity-60' : ''} ${isExpanded ? 'bg-terracotta-50/40' : ''} ${canExpand ? 'cursor-pointer' : ''}`}
                  onClick={canExpand ? () => setExpandedCode((cur) => (cur === a.code ? null : a.code)) : undefined}
                >
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums">
                    <div className="flex items-center gap-1">
                      {canExpand ? (
                        <span className="text-slate-400">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                      ) : (
                        <span className="w-3.5" />
                      )}
                      {a.volgorde}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {a.code}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{a.naam}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {a.type_bewerking ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">
                        {a.type_bewerking}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">— alleen stickeren —</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {a.heeft_band_kleur ? (
                      <span className="text-xs text-slate-600">Ja</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {a.prijs_per_meter > 0 ? `€ ${formatNumber(a.prijs_per_meter, 2)}/m` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {a.actief ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        Actief
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                        Inactief
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditAfw(a)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:border-terracotta-300 hover:text-terracotta-600"
                        title="Bewerken"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(a)}
                        disabled={deleteMut.isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                        title="Verwijderen"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && canExpand && (
                  <AfwerkingKleurenSubmenu afwerkingCode={a.code} colSpan={COL_COUNT} />
                )}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 max-w-2xl">
        Afwerkingen sturen via <code className="px-1 bg-slate-100 rounded">type_bewerking</code> de
        confectie-planning aan (mig 096). Codes zonder lane (bv. ON, ZO) verschijnen onder
        &quot;alleen stickeren&quot;. Klap een afwerking met bandkleur uit om de bijbehorende
        kleur-labels te beheren (bv. &quot;Piero Taupe 431&quot; onder Smalband). Default-bandkleur per
        kwaliteit/kleur wordt op de productenpagina ingesteld.
      </p>

      {showCreate && (
        <AfwerkingFormDialog defaultVolgorde={nextVolgorde} onClose={() => setShowCreate(false)} />
      )}
      {editAfw && <AfwerkingFormDialog afwerking={editAfw} onClose={() => setEditAfw(null)} />}
    </>
  )
}
