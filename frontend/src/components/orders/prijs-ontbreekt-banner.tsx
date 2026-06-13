import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeEuro, Loader2, Check, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

interface Props {
  orderId: number
  /** orders.prijs_ontbreekt_sinds (ISO) — sinds wanneer de gate open staat. */
  teBevestigenSinds: string
}

/**
 * Blokkade-banner (mig 393): deze order heeft ≥1 regel zonder prijs (€0/NULL).
 * Harde blokkade — start_pickronden weigert de order tot de prijs gecorrigeerd
 * of bewust bevestigd is (aanleiding: Shopify-orders die zonder prijs binnenkwamen).
 *
 * Twee uitwegen:
 *   - "Corrigeer prijs" → order bewerken (trigger wist de gate automatisch).
 *   - "€0 klopt — bevestigen" → markeer_prijs_geaccepteerd (operator accepteert
 *     de €0 bewust, bv. een echte gratis-actie). Audit via order_events.
 */
export function PrijsOntbreektBanner({ orderId, teBevestigenSinds }: Props) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBevestig() {
    setBusy(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('markeer_prijs_geaccepteerd', {
        p_order_id: orderId,
      })
      if (rpcErr) throw rpcErr

      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2 font-medium text-amber-900">
        <BadgeEuro size={18} />
        Prijs ontbreekt
      </div>

      <div className="mb-3 text-sm text-amber-900">
        Deze order heeft één of meer regels zonder prijs (€&nbsp;0,00). Dat mag niet
        ongemerkt worden gepickt of gefactureerd. Corrigeer de prijs, of bevestig
        dat €&nbsp;0,00 hier bewust klopt. Open sinds{' '}
        {new Date(teBevestigenSinds).toLocaleString('nl-NL')}.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/orders/${orderId}/bewerken`}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <Pencil size={14} />
          Corrigeer prijs
        </Link>
        <button
          onClick={handleBevestig}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          title="Bevestigt dat de €0-prijs(en) op deze order bewust kloppen — daarna kan de pickronde starten."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          € 0,00 klopt — bevestigen
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
