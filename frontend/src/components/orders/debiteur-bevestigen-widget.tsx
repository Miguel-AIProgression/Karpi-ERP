import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { UserCheck, Pencil } from 'lucide-react'
import { bevestigDebiteur } from '@/lib/supabase/queries/order-mutations'
import { useAuth } from '@/hooks/use-auth'

/** Leesbare omschrijving van de match-strategie (mig 322 / debiteur-matcher-seam). */
const BRON_LABEL: Record<string, string> = {
  company_name_ilike: 'gevonden via gedeeltelijke bedrijfsnaam',
  billing_company_ilike: 'gevonden via gedeeltelijke factuur-bedrijfsnaam',
  email: 'gevonden via e-mailadres',
  bedrijfsnaam: 'gevonden via bedrijfsnaam',
}

/**
 * Bevestig-widget op order-detail voor een onzekere (fuzzy) debiteur-match
 * (mig 322). Verschijnt alleen als debiteur_zeker=false én de bron geen
 * env_fallback is. De operator ziet de gegokte klant + hoe die geraden is en:
 *   - Bevestigt (klopt) → debiteur_zeker=true, order verdwijnt uit de banner;
 *   - Of corrigeert via order-bewerken (klopt niet) — daar staat de debiteur-keuze.
 */
export function DebiteurBevestigenWidget({
  orderId,
  klantNaam,
  debiteurNr,
  matchBron,
}: {
  orderId: number
  klantNaam: string
  debiteurNr: number
  matchBron: string | null | undefined
}) {
  const qc = useQueryClient()
  // Externe vertegenwoordiger (mig 489): read-only — geen debiteur-bevestiging.
  const { isExternRep } = useAuth()
  const mutatie = useMutation({
    mutationFn: () => bevestigDebiteur(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['orders', 'debiteur-te-bevestigen-count'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
    },
  })

  if (isExternRep) return null

  const bronTekst = matchBron ? BRON_LABEL[matchBron] ?? `geraden (${matchBron})` : 'automatisch geraden'

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-5 py-4">
      <div className="flex items-start gap-3">
        <UserCheck size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">Debiteur te bevestigen</p>
          <p className="mt-1 text-sm text-amber-800">
            Deze order is automatisch gekoppeld aan{' '}
            <span className="font-medium">{klantNaam}</span> (#{debiteurNr}) — {bronTekst}.
            Controleer of dit de juiste klant is.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => mutatie.mutate()}
              disabled={mutatie.isPending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              <UserCheck size={14} />
              {mutatie.isPending ? 'Bevestigen...' : 'Klopt, bevestig debiteur'}
            </button>
            <Link
              to={`/orders/${orderId}/bewerken`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
            >
              <Pencil size={14} />
              Klopt niet, wijzig
            </Link>
          </div>
          {mutatie.isError && (
            <p className="mt-2 text-xs text-rose-600">Bevestigen mislukt — probeer opnieuw.</p>
          )}
        </div>
      </div>
    </div>
  )
}
