// frontend/src/modules/logistiek/components/colli-pick-vinkjes.tsx
import { useState } from 'react'
import { CheckSquare, AlertCircle, X } from 'lucide-react'
import {
  useColliVoorZending,
  useHerstelColli,
  useMarkeerColliNietGevonden,
  type PickColliRij,
} from '@/modules/magazijn'
import { cn } from '@/lib/utils/cn'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  zendingId: number
  /** order.lever_modus — sinds mig 518 niet meer gebruikt (niet-gevonden gaat
   *  altijd naar de Manco-backorder, geen splits-keuze meer). Blijft als prop
   *  staan zodat de printset-pagina onveranderd blijft. */
  leverModus?: 'deelleveringen' | 'in_een_keer' | null
  /** Picker-id voor audit op niet-gevonden-markering (mig 217). */
  pickerId: number | null
}

export function ColliPickVinkjes({ zendingId, pickerId }: Props) {
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
            Vinkjes zijn standaard aan. Markeer alleen colli's die je niet kunt vinden —
            de rest gaat gewoon mee, niet-gevonden colli belanden op de Manco-werklijst.
          </p>
        </div>
        {aantalNietGevonden > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
            <AlertCircle size={13} />
            {aantalNietGevonden} naar Manco
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {colli.map((c) => (
          <ColliRij
            key={c.id}
            colli={c}
            onMarkeerNietGevonden={() => setDialogColli(c)}
          />
        ))}
      </ul>
      {dialogColli && (
        <NietGevondenDialog
          colli={dialogColli}
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
  const isOpen = colli.pick_uitkomst === 'open'
  const isNietGevonden = colli.pick_uitkomst === 'niet_gevonden'
  // Externe vertegenwoordiger (mig 489): read-only — geen pick-acties.
  const { isExternRep } = useAuth()
  const herstel = useHerstelColli()
  const [error, setError] = useState<string | null>(null)
  // 'open' = standaard aanwezig/te picken → toon als aangevinkt (zoals de
  // instructie belooft: "vinkjes staan al aan"). Alleen 'niet_gevonden' is een
  // uitgevinkt/probleem-vinkje. 'gepickt' (na voltooien) blijft uiteraard aan.

  async function herstelColliPick() {
    setError(null)
    try {
      await herstel.mutateAsync(colli.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li className="py-2 flex items-center gap-3">
      {isNietGevonden ? (
        <X size={18} className="text-amber-500 shrink-0" />
      ) : (
        <CheckSquare size={18} className="text-emerald-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm', isNietGevonden && 'text-amber-700 line-through')}>
          {colli.omschrijving_snapshot ?? `Colli ${colli.colli_nr}`}
        </div>
        {colli.sscc && (
          <div className="text-xs text-slate-400 font-mono">SSCC {colli.sscc}</div>
        )}
        {colli.pick_opmerking && (
          <div className="text-xs text-amber-600 mt-0.5">⚠ {colli.pick_opmerking}</div>
        )}
        {error && <div className="text-xs text-rose-600 mt-0.5">{error}</div>}
      </div>
      {!isExternRep && !isNietGevonden && isOpen && (
        <button
          onClick={onMarkeerNietGevonden}
          className="text-xs text-slate-500 hover:text-amber-600"
        >
          Niet gevonden
        </button>
      )}
      {!isExternRep && isNietGevonden && (
        <button
          onClick={herstelColliPick}
          disabled={herstel.isPending}
          className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        >
          Toch gevonden
        </button>
      )}
    </li>
  )
}

function NietGevondenDialog({
  colli,
  pickerId,
  onClose,
}: {
  colli: PickColliRij
  pickerId: number | null
  onClose: () => void
}) {
  const mutate = useMarkeerColliNietGevonden()
  const [opmerking, setOpmerking] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    // Picker optioneel (mig 394): niet langer geblokkeerd op lege picker.
    setError(null)
    try {
      await mutate.mutateAsync({ colliId: colli.id, opmerking: opmerking || null, pickerId })
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
        <p className="text-xs text-slate-500 mb-3">
          Deze colli blokkeert de zending niet — de rest wordt gewoon verzonden en
          deze regel gaat naar de Manco-werklijst voor de binnendienst.
        </p>
        <textarea
          value={opmerking}
          onChange={(e) => setOpmerking(e.target.value)}
          placeholder="Optionele opmerking voor de binnendienst"
          rows={2}
          className="w-full text-sm rounded border border-slate-200 p-2 mb-3"
        />
        {error && <div className="mb-2 text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900">
            Annuleer
          </button>
          <button
            onClick={submit}
            disabled={mutate.isPending}
            className="px-3 py-2 rounded bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            Markeer als niet gevonden
          </button>
        </div>
      </div>
    </div>
  )
}
