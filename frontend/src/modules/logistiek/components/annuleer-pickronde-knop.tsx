// frontend/src/modules/logistiek/components/annuleer-pickronde-knop.tsx
//
// Pickronde annuleren (mig 398): vangnet om een per ongeluk gestarte pickronde
// terug te draaien zolang er nog NIETS gepickt is. Verwijdert de zending en zet
// de order(s) terug naar 'Klaar voor picken'. Bewust onderscheiden van Voltooien
// én van de navigatie-knop "Terug uit pickronde" (die laat de pickronde intact en
// gaat alleen terug naar het overzicht): dit is een correctie, geen werkvloer-
// flow — daarom subtiel weergegeven en achter een bevestiging.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Undo2 } from 'lucide-react'
import { useAnnuleerPickronde, useColliVoorZending } from '@/modules/magazijn'
import { useAuth } from '@/hooks/use-auth'
import { isZendingGepland, isZendingLopend } from '@/modules/logistiek/lib/zending-status'

interface Props {
  zendingId: number
  zendingStatus: string
}

export function AnnuleerPickrondeKnop({ zendingId, zendingStatus }: Props) {
  const navigate = useNavigate()
  const { data: colli = [] } = useColliVoorZending(zendingId)
  const mutate = useAnnuleerPickronde()
  const [bevestig, setBevestig] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Externe vertegenwoordiger (mig 489): read-only — geen annuleer-actie.
  const { isExternRep } = useAuth()

  if (isExternRep) return null

  // Mig 478: ook een nog-niet-gestarte ('Gepland') deelzending mag terug —
  // zelfs veiliger dan 'Picken' (er is per definitie nog niets gepickt).
  if (!isZendingLopend(zendingStatus)) return null
  const nogNietGestart = isZendingGepland(zendingStatus)

  // Zodra er iets gepickt/niet-gevonden is, kan terugdraaien niet meer (backend
  // weigert ook). Dan tonen we de knop niet — voltooien is de weg.
  const ietsGepickt = colli.some((c) => c.pick_uitkomst !== 'open')
  if (ietsGepickt) return null

  async function handleAnnuleer() {
    setError(null)
    try {
      await mutate.mutateAsync({
        zendingId,
        reden: nogNietGestart ? 'Deelzending verwijderd vóór start' : 'Handmatig teruggedraaid vanaf Verzendset',
      })
      navigate('/pick-ship')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!bevestig) {
    return (
      <button
        onClick={() => setBevestig(true)}
        title={
          nogNietGestart
            ? "Deze deelzending is nog niet gestart — verwijder de reservering als je 'm niet (meer) wilt."
            : "Per ongeluk gestart? Draai deze pickronde terug — de zending vervalt en de order(s) gaan terug naar Klaar voor picken. Dit annuleert de pickronde; gebruik 'Terug uit pickronde' als je alleen naar het overzicht wilt."
        }
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 hover:border-rose-400"
      >
        <Undo2 size={16} />
        {nogNietGestart ? 'Deelzending verwijderen' : 'Pickronde annuleren'}
      </button>
    )
  }

  return (
    <div className="inline-flex flex-col items-end gap-1.5">
      <div className="inline-flex items-center gap-2">
        <span className="text-sm text-slate-600">
          {nogNietGestart ? 'Zeker? De gereserveerde regels komen terug bij de rest van de order.' : 'Zeker? Zending vervalt, order(s) terug naar Klaar voor picken.'}
        </span>
        <button
          onClick={() => setBevestig(false)}
          disabled={mutate.isPending}
          className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-45"
        >
          Annuleren
        </button>
        <button
          onClick={handleAnnuleer}
          disabled={mutate.isPending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-45"
        >
          {mutate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          {nogNietGestart ? 'Ja, verwijderen' : 'Ja, terugdraaien'}
        </button>
      </div>
      {error && <div className="max-w-72 text-right text-xs text-rose-600">{error}</div>}
    </div>
  )
}
