import { useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, Check, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { verzendWeekKort } from '@/lib/orders/verzendweek'
import { fetchLaatsteLevertijdWijziging } from '@/lib/supabase/queries/orders'

interface Props {
  orderId: number
  /** Sinds wanneer de wijziging open staat — orders.levertijd_wijziging_te_bevestigen_sinds (ISO). */
  teBevestigenSinds: string
}

const BRON_LABEL: Record<string, string> = {
  leverancier: 'de leverancier',
  karpi: 'Karpi (intern)',
}

/**
 * Signaleringspaneel (mig 326): toont dat de levertijd van deze order is
 * verschoven doordat een leverancier (portal) of Karpi intern de ETA op een
 * gekoppelde inkooporderregel heeft aangepast — en biedt een handmatige
 * "herbevestigd aan klant"-afvinking (geen automatische communicatie, zoals
 * afgesproken: de operator informeert de klant zelf en legt het hier vast).
 * Mirrort qua opzet `EdiLeverweekBevestigen`.
 */
export function LevertijdWijzigingBanner({ orderId, teBevestigenSinds }: Props) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: event, isLoading } = useQuery({
    queryKey: ['levertijd-wijziging-event', orderId],
    queryFn: () => fetchLaatsteLevertijdWijziging(orderId),
    staleTime: 60_000,
  })

  const meta = event?.metadata
  const bronLabel = meta?.eta_bijgewerkt_door ? BRON_LABEL[meta.eta_bijgewerkt_door] : null

  async function handleHerbevestigd() {
    setBusy(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('markeer_levertijd_herbevestigd', {
        p_order_id: orderId,
      })
      if (rpcErr) throw rpcErr

      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
      qc.invalidateQueries({ queryKey: ['levertijd-wijziging-event', orderId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2 font-medium text-amber-900">
        <CalendarClock size={18} />
        Levertijd gewijzigd door nieuwe ETA
      </div>

      {meta && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <div>
            <div className="text-slate-500">Was</div>
            <div className="font-medium text-slate-800">
              {meta.afleverdatum_oud
                ? `${verzendWeekKort(meta.afleverdatum_oud)} · ${meta.afleverdatum_oud}`
                : '—'}
            </div>
          </div>
          <ArrowRight size={16} className="mt-3 text-amber-600" />
          <div>
            <div className="text-slate-500">Wordt</div>
            <div className="font-medium text-slate-800">
              {meta.afleverdatum_nieuw
                ? `${verzendWeekKort(meta.afleverdatum_nieuw)} · ${meta.afleverdatum_nieuw}`
                : '—'}
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 text-sm text-amber-900">
        De leverweek voor deze order is verschoven{bronLabel ? ` doordat ${bronLabel} de ETA op een gekoppelde inkooporderregel heeft aangepast` : ' door een ETA-update op een gekoppelde inkooporderregel'}.
        {' '}Open sinds {new Date(teBevestigenSinds).toLocaleString('nl-NL')}.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleHerbevestigd}
          disabled={busy || isLoading}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-terracotta-500 px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-600 disabled:opacity-50"
          title="Markeert dat je de klant handmatig hebt geïnformeerd over de gewijzigde levertijd. Verstuurt zelf geen bericht."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Herbevestigd aan klant ✓
        </button>
        <span className="text-xs text-slate-500">
          Puur administratief — informeer de klant zelf; dit vinkt het alleen af.
        </span>
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
