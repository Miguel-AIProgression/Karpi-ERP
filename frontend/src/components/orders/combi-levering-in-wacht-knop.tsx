import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { stuurOrderbevestiging } from './bevestig-order-dialog'

interface Props {
  orderId: number
  orderNr: string
}

interface OrderCombiLeveringRow {
  debiteur_nr: number
  combi_levering_override: boolean
  status: string
  debiteuren: {
    combi_levering: boolean
    email_overig: string | null
    email_factuur: string | null
  } | null
}

// Code-review-fix: zelfde statuslijst als de guard in
// herwaardeer_combi_levering_verzendregel (mig 561) — een order die al fysiek
// onderweg/verzonden/geannuleerd is, mag deze knop niet meer tonen (het
// klantbrede combi_levering-effect + een nieuwe orderbevestiging zijn dan
// niet meer van toepassing op DEZE order).
const GEEN_COMBI_LEVERING_KNOP_STATUSSEN: ReadonlySet<string> = new Set([
  'Geannuleerd', 'Verzonden', 'In pickronde', 'Deels verzonden',
])

/**
 * Mig 560/ADR-0039: scenario waarin een klant ná zijn orderbevestiging alsnog
 * belt om te wachten i.p.v. verzendkosten te betalen. Zichtbaar zolang de
 * klant nog niet op combi_levering staat (anders is er niets te "zetten") en
 * deze order niet al fysiek onderweg/verzonden/geannuleerd is.
 */
export function CombiLeveringInWachtKnop({ orderId }: Props) {
  const [gedaan, setGedaan] = useState(false)
  const [mailVerstuurd, setMailVerstuurd] = useState(false)
  // Mig 494/audit 02-07: externe vertegenwoordiger is read-only — RLS blokkeert
  // de UPDATEs stil (0 rijen), maar de klant-mail zou wél echt vertrekken.
  const { isExternRep } = useAuth()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['orders', orderId, 'combi-levering-in-wacht-knop'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('debiteur_nr, combi_levering_override, status, debiteuren!orders_debiteur_nr_fkey(combi_levering, email_overig, email_factuur)')
        .eq('id', orderId)
        .single()
      if (error) throw error
      return data as unknown as OrderCombiLeveringRow
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('zet_order_in_combi_levering_wacht', {
        p_order_id: orderId,
      })
      if (error) throw error

      const { data: { user } } = await supabase.auth.getUser()
      const email = data?.debiteuren?.email_overig ?? data?.debiteuren?.email_factuur ?? null
      if (email) {
        await stuurOrderbevestiging({
          orderId,
          email,
          bevestigdDoor: user?.email ?? user?.id ?? 'onbekend',
        })
      }
      // Code-review-fix: het succesbericht mag alleen "nieuwe bevestiging
      // verstuurd" claimen als er ook echt een e-mailadres was.
      return { mailVerstuurd: !!email }
    },
    onSuccess: (result) => {
      setGedaan(true)
      setMailVerstuurd(result.mailVerstuurd)
      queryClient.invalidateQueries({ queryKey: ['orders', orderId] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  if (isExternRep || !data || data.debiteuren?.combi_levering || GEEN_COMBI_LEVERING_KNOP_STATUSSEN.has(data.status)) {
    return null
  }

  if (gedaan) {
    return (
      <span className="text-sm text-emerald-700">
        Combi-levering staat nu aan voor deze klant — openstaande orders naar dit adres wachten voortaan tot de vrachtvrije-drempel gehaald is
        {mailVerstuurd
          ? ' — nieuwe bevestiging verstuurd.'
          : ' (geen e-mailadres bekend bij deze klant — géén nieuwe bevestiging verstuurd).'}
      </span>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title="Zet de Combi-levering-instelling aan voor de hele klant — raakt dus ook alle andere openstaande orders van deze klant naar hetzelfde adres, niet alleen deze order."
        className="text-sm text-terracotta-500 hover:text-terracotta-700 font-medium disabled:opacity-50"
      >
        {mutation.isPending ? 'Bezig...' : 'Zet order in de wacht voor Combi-levering'}
      </button>
      <p className="text-xs text-slate-400 mt-1">
        Zet de instelling klantbreed aan — geldt ook voor andere openstaande orders van deze klant naar hetzelfde adres.
      </p>
      {mutation.isError && (
        <p className="text-xs text-rose-600 mt-1">
          {mutation.error instanceof Error ? mutation.error.message : 'Er is iets misgegaan'}
        </p>
      )}
    </div>
  )
}
