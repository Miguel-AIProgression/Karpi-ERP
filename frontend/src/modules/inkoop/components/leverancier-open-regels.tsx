import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Pencil, CheckCircle2, X } from 'lucide-react'
import { fetchOpenRegelsVoorLeverancier, updateRegelEta, type OpenRegelRow } from '../queries/leveranciers'

interface Props {
  leverancierId: number
}

function formatDatum(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function EtaEditCell({
  regel,
  leverancierId,
}: {
  regel: OpenRegelRow
  leverancierId: number
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(regel.verwacht_datum ?? '')
  const [notitie, setNotitie] = useState(regel.leverancier_notitie ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => updateRegelEta(regel.regel_id, value, leverancierId, notitie || null),
    onSuccess: () => {
      setEditing(false)
      setSaveError(null)
      qc.invalidateQueries({ queryKey: ['leverancier-open-regels', leverancierId] })
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-[140px]">
        <div className="flex-1">
          <div className={`text-sm ${regel.regel_verwacht_datum ? 'font-medium' : 'text-slate-500'}`}>
            {formatDatum(regel.verwacht_datum)}
          </div>
          {regel.eta_bijgewerkt_op && (
            <div className="text-xs text-slate-400 mt-0.5">
              {regel.eta_bijgewerkt_door === 'leverancier' ? 'Leverancier' : 'Karpi'}{' '}
              {formatDatum(regel.eta_bijgewerkt_op.slice(0, 10))}
            </div>
          )}
        </div>
        <button
          onClick={() => { setEditing(true); setValue(regel.verwacht_datum ?? '') }}
          className="flex-shrink-0 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
          title="ETA aanpassen"
        >
          <Pencil size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 min-w-[200px]">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full text-sm border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-400"
        autoFocus
      />
      <input
        type="text"
        value={notitie}
        onChange={(e) => setNotitie(e.target.value)}
        placeholder="Notitie (optioneel)"
        className="block w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300"
      />
      {saveError && <div className="text-xs text-red-500">{saveError}</div>}
      <div className="flex gap-1.5">
        <button
          onClick={() => mutation.mutate()}
          disabled={!value || mutation.isPending}
          className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50"
        >
          <CheckCircle2 size={12} />
          {mutation.isPending ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          onClick={() => { setEditing(false); setSaveError(null) }}
          className="p-1 rounded hover:bg-slate-100 text-slate-400"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

export function LeverancierOpenRegels({ leverancierId }: Props) {
  const [sortBy, setSortBy] = useState<'eta' | 'order'>('eta')

  const { data: regels = [], isLoading, error } = useQuery({
    queryKey: ['leverancier-open-regels', leverancierId],
    queryFn: () => fetchOpenRegelsVoorLeverancier(leverancierId),
    staleTime: 30_000,
  })

  const sorted = [...regels].sort((a, b) => {
    if (sortBy === 'eta') {
      const da = a.verwacht_datum ?? '9999'
      const db = b.verwacht_datum ?? '9999'
      return da < db ? -1 : da > db ? 1 : 0
    }
    return a.inkooporder_nr < b.inkooporder_nr ? -1 : 1
  })

  if (isLoading) {
    return <div className="py-8 text-center text-slate-400 text-sm">Laden…</div>
  }
  if (error) {
    return <div className="py-8 text-center text-red-500 text-sm">Fout bij laden regels</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {regels.length} open regel{regels.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-400">Sorteren:</span>
          <button
            onClick={() => setSortBy('eta')}
            className={`px-2 py-1 rounded border text-xs transition-colors ${
              sortBy === 'eta'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-200 text-slate-600 hover:border-slate-400'
            }`}
          >
            <CalendarDays size={12} className="inline mr-1" />
            ETA
          </button>
          <button
            onClick={() => setSortBy('order')}
            className={`px-2 py-1 rounded border text-xs transition-colors ${
              sortBy === 'order'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-200 text-slate-600 hover:border-slate-400'
            }`}
          >
            Inkooporder
          </button>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="py-8 text-center text-slate-400 text-sm">
          Geen openstaande regels
        </div>
      )}

      {sorted.length > 0 && (
        <div className="border border-slate-200 rounded-[var(--radius)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-medium">Inkooporder</th>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">Besteld</th>
                <th className="px-4 py-2 text-right font-medium">Geleverd</th>
                <th className="px-4 py-2 text-right font-medium">Resterend</th>
                <th className="px-4 py-2 text-left font-medium">ETA</th>
                <th className="px-4 py-2 text-left font-medium">Opmerking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const omschrijving =
                  r.artikel_omschrijving ?? r.product_omschrijving ?? r.artikelnr ?? `Regel ${r.regelnummer}`
                const unit = r.eenheid === 'stuks' ? 'st' : 'm'
                return (
                  <tr key={r.regel_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        to={`/inkoop/${r.inkooporder_id}`}
                        className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
                      >
                        {r.inkooporder_nr}
                      </Link>
                      <div className="text-xs text-slate-400">Regel {r.regelnummer}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{omschrijving}</div>
                      {r.karpi_code && (
                        <div className="text-xs text-slate-400">{r.karpi_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600">
                      {r.besteld_m} {unit}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600">
                      {r.geleverd_m} {unit}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-orange-600">
                      {r.te_leveren_m} {unit}
                    </td>
                    <td className="px-4 py-3">
                      <EtaEditCell regel={r} leverancierId={leverancierId} />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {r.leverancier_notitie ? (
                        <span className="text-sm text-blue-700 italic" title={r.leverancier_notitie}>
                          {r.leverancier_notitie}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
