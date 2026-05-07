// frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx
import { useState } from 'react'
import { CheckSquare, Square, AlertCircle, X } from 'lucide-react'
import {
  useColliVoorZending,
  useMarkeerColliNietGevonden,
  type NietGevondenModus,
  type PickColliRij,
} from '@/modules/magazijn'
import { cn } from '@/lib/utils/cn'

interface Props {
  zendingId: number
  /** order.lever_modus — bepaalt of 'splits'-optie beschikbaar is. */
  leverModus: 'deelleveringen' | 'in_een_keer' | null
  /** Picker-id voor audit op niet-gevonden-markering (mig 217). */
  pickerId: number | null
}

export function ColliPickVinkjes({ zendingId, leverModus, pickerId }: Props) {
  const { data: colli = [], isLoading } = useColliVoorZending(zendingId)
  const [dialogColli, setDialogColli] = useState<PickColliRij | null>(null)

  if (isLoading) return <div className="text-sm text-slate-500">Colli laden...</div>
  if (colli.length === 0) return null

  const aantalNietGevonden = colli.filter((c) => c.pick_uitkomst === 'niet_gevonden').length

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Pick-status per colli</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Vinkjes zijn standaard aan. Markeer alleen colli's die je niet kunt vinden.
          </p>
        </div>
        {aantalNietGevonden > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertCircle size={13} />
            {aantalNietGevonden} probleem
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {colli.map((c) => (
          <ColliRij key={c.id} colli={c} onMarkeerNietGevonden={() => setDialogColli(c)} />
        ))}
      </ul>
      {dialogColli && (
        <NietGevondenDialog
          colli={dialogColli}
          leverModus={leverModus}
          pickerId={pickerId}
          onClose={() => setDialogColli(null)}
        />
      )}
    </div>
  )
}

function ColliRij({
  colli,
  onMarkeerNietGevonden,
}: {
  colli: PickColliRij
  onMarkeerNietGevonden: () => void
}) {
  const isGepickt = colli.pick_uitkomst === 'gepickt'
  const isOpen = colli.pick_uitkomst === 'open'
  const isNietGevonden = colli.pick_uitkomst === 'niet_gevonden'

  return (
    <li className="py-2 flex items-center gap-3">
      {isNietGevonden ? (
        <X size={18} className="text-rose-500 shrink-0" />
      ) : isGepickt ? (
        <CheckSquare size={18} className="text-emerald-500 shrink-0" />
      ) : (
        <Square size={18} className="text-slate-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm', isNietGevonden && 'text-rose-700 line-through')}>
          {colli.omschrijving_snapshot ?? `Colli ${colli.colli_nr}`}
        </div>
        {colli.sscc && (
          <div className="text-xs text-slate-400 font-mono">SSCC {colli.sscc}</div>
        )}
        {colli.pick_opmerking && (
          <div className="text-xs text-rose-600 mt-0.5">⚠ {colli.pick_opmerking}</div>
        )}
      </div>
      {!isNietGevonden && isOpen && (
        <button
          onClick={onMarkeerNietGevonden}
          className="text-xs text-slate-500 hover:text-rose-600"
        >
          Niet gevonden
        </button>
      )}
    </li>
  )
}

function NietGevondenDialog({
  colli,
  leverModus,
  pickerId,
  onClose,
}: {
  colli: PickColliRij
  leverModus: 'deelleveringen' | 'in_een_keer' | null
  pickerId: number | null
  onClose: () => void
}) {
  const mutate = useMarkeerColliNietGevonden()
  const [opmerking, setOpmerking] = useState('')
  const [error, setError] = useState<string | null>(null)
  const splitsAllowed = leverModus === 'deelleveringen'

  async function submit(modus: NietGevondenModus) {
    if (!pickerId) {
      setError('Kies eerst een picker bovenaan')
      return
    }
    setError(null)
    try {
      await mutate.mutateAsync({ colliId: colli.id, modus, opmerking: opmerking || null, pickerId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">Colli niet gevonden</h3>
        <p className="text-sm text-slate-600 mb-3">
          {colli.omschrijving_snapshot ?? `Colli ${colli.colli_nr}`}
        </p>
        <textarea
          value={opmerking}
          onChange={(e) => setOpmerking(e.target.value)}
          placeholder="Optionele opmerking voor de magazijnchef"
          rows={2}
          className="w-full text-sm rounded border border-slate-200 p-2 mb-3"
        />
        <div className="space-y-2">
          <button
            onClick={() => submit('blokkeer')}
            disabled={mutate.isPending}
            className="w-full text-left px-3 py-2 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
          >
            <div className="font-medium text-sm">Blokkeer & escaleer</div>
            <div className="text-xs text-slate-600">
              Pickronde wacht tot magazijnchef het probleem oplost
            </div>
          </button>
          <button
            onClick={() => submit('splits')}
            disabled={mutate.isPending || !splitsAllowed}
            className="w-full text-left px-3 py-2 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
          >
            <div className="font-medium text-sm">Splits zending</div>
            <div className="text-xs text-slate-600">
              {splitsAllowed
                ? 'Verzend de overige colli\'s; deze regel blijft open in de order'
                : 'Niet beschikbaar — order.lever_modus is niet "deelleveringen"'}
            </div>
          </button>
        </div>
        {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900">
            Annuleer
          </button>
        </div>
      </div>
    </div>
  )
}
