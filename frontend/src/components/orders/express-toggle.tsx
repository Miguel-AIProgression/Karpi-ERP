import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { setExpress, fetchMaatwerkGroepenVoorOrder } from '@/lib/supabase/queries/order-mutations'
import { triggerAutoplan } from '@/modules/snijplanning'

/**
 * Handmatige express-vlag (mig 450, Fase 2) — toggle i.p.v. eenmalige
 * bevestiging: een order kan op elk moment in/uit express gezet worden.
 * Krijgt na het zetten de hoogste sorteerprioriteit in de snijplanner
 * (sortPieces, _shared/ffdh-packing.ts). Triggert auto-plan-groep voor elke
 * (kwaliteit, kleur) van de maatwerk-regels zodat de heroptimalisatie meteen
 * plaatsvindt — anders wacht het tot de volgende reguliere trigger. Een
 * eventuele verdringing van een al-gepland stuk wordt daar afgevangen
 * (auto-plan-groep's verdringingscheck): het voorstel blijft dan 'concept'
 * voor handmatige beoordeling i.p.v. stilletjes door te schuiven.
 */
export function ExpressToggle({ orderId, express }: { orderId: number; express: boolean }) {
  const qc = useQueryClient()

  const mutatie = useMutation({
    mutationFn: async () => {
      const nieuw = !express
      await setExpress(orderId, nieuw)
      try {
        const groepen = await fetchMaatwerkGroepenVoorOrder(orderId)
        await Promise.allSettled(
          groepen.map((g) => triggerAutoplan(g.kwaliteit_code, g.kleur_code)),
        )
      } catch (e) {
        console.warn('Auto-plan trigger na express-toggle faalde (niet-blokkerend):', e)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
    },
  })

  if (express) {
    return (
      <button
        type="button"
        onClick={() => mutatie.mutate()}
        disabled={mutatie.isPending}
        title="Klik om express-prioriteit weer uit te zetten"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-rose-100 text-rose-700 text-xs font-semibold hover:bg-rose-200 transition-colors disabled:opacity-50"
      >
        <Zap size={12} className="fill-current" />
        Express
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => mutatie.mutate()}
      disabled={mutatie.isPending}
      title="Geeft deze order hoogste prioriteit bij het snijden van maatwerk"
      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      <Zap size={12} />
      {mutatie.isPending ? 'Bezig…' : 'Markeer als express'}
    </button>
  )
}
