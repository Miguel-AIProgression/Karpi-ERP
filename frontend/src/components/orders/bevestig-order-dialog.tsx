import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { CheckCircle, Mail, Loader2 } from 'lucide-react'
import { bevestigOrderZonderEdiBericht } from '@/modules/edi'

interface BevestigOrderDialogProps {
  orderId: number
  orderNr: string
  defaultEmail: string | null
  isHerversturing?: boolean
  /**
   * True als dit een EDI-order is die via e-mail bevestigd wordt (partner zonder
   * actieve EDI-orderbev — besluit 11-06). Na succesvolle verzending wordt ook de
   * EDI-leverweek-gate (edi_bevestigd_op) gesloten zodat het "Te bevestigen"-chip
   * en het amber paneel verdwijnen.
   */
  sluitEdiGate?: boolean
  onClose: () => void
}

async function stuurOrderbevestiging(params: {
  orderId: number
  email: string
  bevestigdDoor: string
}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stuur-orderbevestiging`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        order_id: params.orderId,
        email: params.email,
        bevestigd_door: params.bevestigdDoor,
      }),
    },
  )

  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as { order_nr: string; verstuurd_naar: string; bevestigd_at: string }
}

export function BevestigOrderDialog({ orderId, orderNr, defaultEmail, isHerversturing = false, sluitEdiGate = false, onClose }: BevestigOrderDialogProps) {
  const [email, setEmail] = useState(defaultEmail ?? '')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return stuurOrderbevestiging({
        orderId,
        email,
        bevestigdDoor: user?.email ?? user?.id ?? 'onbekend',
      })
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['order', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })

      // Bij een EDI-order die via e-mail bevestigd wordt: sluit ook de EDI-
      // leverweek-gate (edi_bevestigd_op) zodat het "Te bevestigen"-chip en
      // het amber paneel verdwijnen. Best-effort: fout breekt succes-UX niet.
      if (sluitEdiGate) {
        try {
          await bevestigOrderZonderEdiBericht(orderId)
          qc.invalidateQueries({ queryKey: ['edi-berichten'] })
          qc.invalidateQueries({ queryKey: ['edi-inkomend-voor-order', orderId] })
          qc.invalidateQueries({ queryKey: ['edi-uitgaand-voor-order', orderId] })
        } catch (gateErr) {
          console.warn('[BevestigOrderDialog] edi-gate sluiten mislukt (niet-blokkerend):', gateErr)
        }
      }
    },
  })

  const isSuccess = mutation.isSuccess

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-md w-full mx-4">
        {isSuccess ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="text-green-500" size={40} />
              <h3 className="text-lg font-semibold text-slate-900">Orderbevestiging verstuurd</h3>
              <p className="text-sm text-slate-600 text-center">
                De orderbevestiging van <strong>{orderNr}</strong> is per e-mail verstuurd naar{' '}
                <strong>{mutation.data?.verstuurd_naar}</strong>.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 px-4 py-2 bg-slate-100 text-slate-700 rounded-[var(--radius-sm)] hover:bg-slate-200 text-sm font-medium"
            >
              Sluiten
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Mail size={18} className="text-terracotta-500" />
              <h3 className="text-lg font-semibold text-slate-900">
                {isHerversturing ? 'Orderbevestiging opnieuw versturen' : 'Orderbevestiging versturen'}
              </h3>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              {isHerversturing
                ? <>Er wordt een nieuwe PDF-orderbevestiging van <strong>{orderNr}</strong> gegenereerd en per e-mail verstuurd. Het vorige e-mailadres is vooringevuld.</>
                : <>Er wordt een PDF-orderbevestiging van <strong>{orderNr}</strong> gegenereerd en per e-mail verstuurd.</>
              }
            </p>

            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                E-mailadres klant
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="klant@voorbeeld.nl"
                className="w-full px-3 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-300"
              />
              {!defaultEmail && (
                <p className="text-xs text-amber-600 mt-1">
                  Geen e-mail gevonden op klantkaart — vul handmatig in.
                </p>
              )}
            </div>

            {mutation.isError && (
              <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] text-sm text-rose-700">
                {mutation.error instanceof Error ? mutation.error.message : 'Er is iets misgegaan'}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={mutation.isPending}
                className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !email.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-terracotta-500 text-white rounded-[var(--radius-sm)] hover:bg-terracotta-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
                {mutation.isPending ? 'Versturen...' : 'Verstuur bevestiging'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
