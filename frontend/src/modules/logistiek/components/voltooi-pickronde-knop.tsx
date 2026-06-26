// frontend/src/modules/logistiek/components/voltooi-pickronde-knop.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, PackageCheck } from 'lucide-react'
import { useColliVoorZending, useVoltooiPickronde } from '@/modules/magazijn'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  zendingId: number
  zendingStatus: string
  pickerId: number | null
  /** Waarheen na succesvol voltooien. Default '/logistiek'. Voor Rhenus-bundel-
   *  zendingen stuurt de Verzendset-pagina hier de zending-detailpagina in, zodat
   *  de operator direct bij "Colli bundelen" (+ de "Nu aanmelden"-escape-hatch)
   *  landt i.p.v. terug naar het overzicht. NB sinds mig 484 meldt Rhenus
   *  automatisch aan in de dagbatch om 16:00 — er is geen handmatige aanmeld-stap meer. */
  navigeerNaVoltooienNaar?: string
}

export function VoltooiPickrondeKnop({
  zendingId,
  zendingStatus,
  pickerId,
  navigeerNaVoltooienNaar,
}: Props) {
  const navigate = useNavigate()
  const { data: colli = [] } = useColliVoorZending(zendingId)
  const mutate = useVoltooiPickronde()
  const [error, setError] = useState<string | null>(null)
  // Externe vertegenwoordiger (mig 489): read-only — geen voltooi-actie.
  const { isExternRep } = useAuth()

  if (isExternRep) return null
  if (zendingStatus !== 'Picken') return null

  const aantalNietGevonden = colli.filter((c) => c.pick_uitkomst === 'niet_gevonden').length
  // Mig 518: niet-gevonden colli blokkeren de pickronde niet meer — ze gaan
  // automatisch naar de Manco-werklijst en de rest wordt verzonden. Picker
  // optioneel (mig 394): niet langer geblokkeerd op lege picker.
  const disabled = mutate.isPending

  async function handleClick() {
    setError(null)
    try {
      await mutate.mutateAsync({ zendingId, pickerId })
      navigate(navigeerNaVoltooienNaar ?? '/logistiek')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tooltip =
    aantalNietGevonden > 0
      ? `${aantalNietGevonden} niet-gevonden colli gaan naar de Manco-werklijst; de rest wordt verzonden`
      : 'Markeer alle colli als gepickt en sluit de pickronde — order gaat naar Verzonden, factuur volgt'

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={tooltip}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {mutate.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <PackageCheck size={14} />
        )}
        Voltooi pickronde
      </button>
      {error && <div className="max-w-72 text-right text-xs text-rose-600">{error}</div>}
    </div>
  )
}
