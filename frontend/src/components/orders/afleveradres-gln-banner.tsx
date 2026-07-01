import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MapPinOff, Loader2, Check, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  orderId: number
  /** orders.afl_gln_ongekoppeld_sinds (ISO) — sinds wanneer de gate open staat. */
  sinds: string
  /** De aflever-GLN uit het EDI-bericht die geen vestiging matcht. */
  afleveradresGln: string | null
  /** Huidig (fallback-)afleveradres-snapshot, ter controle. */
  aflNaam: string | null
  aflAdres: string | null
  aflPostcode: string | null
  aflPlaats: string | null
}

/**
 * Blokkade-banner (mig 535): de aflever-GLN van deze EDI-order matcht geen
 * vestiging in afleveradressen — create_edi_order (mig 357) viel stil terug op
 * het debiteur-hoofdadres. Harde blokkade: start_pickronden weigert de order tot
 * het adres is opgelost óf bewust vrijgegeven.
 *
 * Twee uitwegen:
 *   - "Adres aanpassen" → order bewerken (corrigeer het afleveradres) en daarna
 *     vrijgeven. De juiste vestiging-GLN koppelen aan het afleveradres (beheer)
 *     wist de gate automatisch én laat toekomstige orders matchen.
 *   - "Adres gecontroleerd — vrijgeven" → markeer_afleveradres_gecontroleerd
 *     (operator bevestigt bewust dat het adres klopt). Audit via order_events.
 */
export function AfleveradresGlnBanner({
  orderId,
  sinds,
  afleveradresGln,
  aflNaam,
  aflAdres,
  aflPostcode,
  aflPlaats,
}: Props) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Externe vertegenwoordiger (mig 489): read-only — geen vrijgave.
  const { isExternRep } = useAuth()

  if (isExternRep) return null

  async function handleVrijgeven() {
    setBusy(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('markeer_afleveradres_gecontroleerd', {
        p_order_id: orderId,
      })
      if (rpcErr) throw rpcErr

      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
      qc.invalidateQueries({ queryKey: ['edi-afleveradres-ongekoppeld'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const huidigAdres = [aflNaam, aflAdres, [aflPostcode, aflPlaats].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
        <MapPinOff size={18} />
        Afleveradres niet gekoppeld
      </div>

      <div className="mb-3 text-sm text-amber-800">
        De aflever-GLN{afleveradresGln ? ` (${afleveradresGln})` : ''} van deze EDI-order matcht{' '}
        <strong>geen vestiging</strong> — het afleveradres viel daardoor terug op het hoofdadres
        {huidigAdres ? (
          <>
            : <strong>{huidigAdres}</strong>
          </>
        ) : null}
        . Controleer of dit het juiste leveradres is voordat de order naar Pick &amp; Ship gaat.
        Open sinds {new Date(sinds).toLocaleString('nl-NL')}.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/orders/${orderId}/bewerken`}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <Pencil size={14} />
          Adres aanpassen
        </Link>
        <button
          onClick={handleVrijgeven}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          title="Bevestigt dat het afleveradres klopt — daarna kan de pickronde starten."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Adres gecontroleerd — vrijgeven
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
