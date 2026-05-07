import { useState } from 'react'
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useBetaalcondities, useDeleteBetaalconditie } from '@/hooks/use-betaalcondities'
import { BetaalconditieFormDialog } from '@/components/instellingen/betaalconditie-form-dialog'
import { BetaalconditieKlantenDialog } from '@/components/instellingen/betaalconditie-klanten-dialog'
import type { BetaalconditieMetAantal } from '@/lib/supabase/queries/betaalcondities'

export function BetaalconditiesInstellingenPage() {
  const { data: condities, isLoading } = useBetaalcondities()
  const deleteMut = useDeleteBetaalconditie()
  const [showCreate, setShowCreate] = useState(false)
  const [editConditie, setEditConditie] = useState<BetaalconditieMetAantal | null>(null)
  const [klantenVoor, setKlantenVoor] = useState<BetaalconditieMetAantal | null>(null)

  const handleDelete = async (c: BetaalconditieMetAantal) => {
    if (c.aantal_klanten > 0) {
      alert(
        `"${c.code} - ${c.naam}" wordt nog gebruikt door ${c.aantal_klanten} klant(en). ` +
          `Wijs ze eerst een andere conditie toe of zet deze op inactief.`,
      )
      return
    }
    if (!confirm(`Betaalconditie "${c.code} - ${c.naam}" definitief verwijderen?`)) return
    try {
      await deleteMut.mutateAsync(c.code)
    } catch (err) {
      alert(`Verwijderen mislukt: ${err instanceof Error ? err.message : 'onbekende fout'}`)
    }
  }

  return (
    <>
      <PageHeader
        title="Betaalcondities"
        description={`${condities?.length ?? 0} condities — verschijnen in de dropdown op klant-detail.`}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Nieuwe betaalconditie
          </button>
        }
      />

      {isLoading ? (
        <div className="text-slate-400">Laden...</div>
      ) : !condities || condities.length === 0 ? (
        <div className="text-slate-400 flex items-center gap-2">
          <Receipt size={18} />
          Nog geen betaalcondities gedefinieerd
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-24">Code</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Naam</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-24">Dagen</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 w-28">Klanten</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 w-24">Status</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {condities.map((c) => (
                <tr
                  key={c.code}
                  className={`border-b border-slate-50 hover:bg-slate-50 ${!c.actief ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    <code className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {c.code}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    <div className="font-medium">{c.naam}</div>
                    {c.omschrijving && (
                      <div className="text-xs text-slate-400 mt-0.5">{c.omschrijving}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {c.dagen != null ? c.dagen : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.aantal_klanten > 0 ? (
                      <button
                        type="button"
                        onClick={() => setKlantenVoor(c)}
                        className="text-terracotta-500 hover:text-terracotta-700 hover:underline font-medium"
                        title={`Toon ${c.aantal_klanten} klant(en) met deze conditie`}
                      >
                        {c.aantal_klanten}
                      </button>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {c.actief ? (
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
                        onClick={() => setEditConditie(c)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:border-terracotta-300 hover:text-terracotta-600"
                        title="Bewerken"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={deleteMut.isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                        title={c.aantal_klanten > 0 ? `Wordt gebruikt door ${c.aantal_klanten} klant(en)` : 'Verwijderen'}
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
        Bij selectie op klant-detail wordt het &quot;{`{code}`} - {`{naam}`}&quot;-formaat in
        <code className="px-1 mx-0.5 bg-slate-100 rounded">debiteuren.betaalconditie</code>
        opgeslagen, zodat de factuur-RPC ongewijzigd blijft werken. Het
        <code className="px-1 mx-0.5 bg-slate-100 rounded">dagen</code>-veld bepaalt de vervaldatum
        — laat leeg om terug te vallen op de default (30).
      </p>

      {showCreate && <BetaalconditieFormDialog onClose={() => setShowCreate(false)} />}
      {editConditie && (
        <BetaalconditieFormDialog conditie={editConditie} onClose={() => setEditConditie(null)} />
      )}
      {klantenVoor && (
        <BetaalconditieKlantenDialog
          code={klantenVoor.code}
          naam={klantenVoor.naam}
          onClose={() => setKlantenVoor(null)}
        />
      )}
    </>
  )
}
