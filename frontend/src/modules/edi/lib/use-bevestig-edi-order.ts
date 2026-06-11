// Gedeelde bevestig-flow voor EDI-orders: gebruikt door het amber
// leverweek-paneel op order-detail én de universele BevestigOrderEdiDialog.
//
// Bepaalt zelf het kanaal ('edi' = ORDRSP versturen, 'email' = partner wil
// geen EDI-orderbev → bevestiging gaat per e-mail via de universele knop)
// op basis van edi_handelspartner_config.
//
// Taakverdeling bij kanaal 'email':
//   - Deze hook doet het administratieve deel van de leverweek-bevestiging:
//     afleverdatum vastzetten + edi_bevestigd_op-gate sluiten via
//     bevestigOrderZonderEdiBericht (zodat het "Te bevestigen"-chip verdwijnt).
//   - De daadwerkelijke orderbev-e-mail gaat via de universele "Bevestig order"-
//     knop in order-header.tsx (BevestigOrderDialog met sluitEdiGate=true).
//   - Besluit 2026-06-11 (Miguel): per documenttype — wat de partner niet via
//     EDI wil, gaat automatisch per e-mail.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import {
  bepaalBevestigingKanaal,
  type BevestigingKanaal,
} from '@/lib/orders/bevestiging-kanaal'
import { fetchInkomendBerichtVoorOrder, fetchHandelspartnerConfig } from '../queries/edi'
import { bevestigOrderViaEdi, bevestigOrderZonderEdiBericht } from './bevestig-helper'
import { KARPI_GLN_DEFAULT, type KarpiOrder } from './karpi-fixed-width'

export function useBevestigEdiOrder(orderId: number, debiteurNr: number) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: bericht, isLoading: berichtLoading } = useQuery({
    queryKey: ['edi-inkomend-voor-order', orderId],
    queryFn: () => fetchInkomendBerichtVoorOrder(orderId),
    // Het inkomende EDI-bericht is onveranderlijk na aanmaak — geen refetch op
    // window-focus nodig.
    staleTime: Infinity,
  })

  const { data: config, isLoading: configLoading, isError: configError } = useQuery({
    queryKey: ['edi-handelspartner-config', debiteurNr],
    queryFn: () => fetchHandelspartnerConfig(debiteurNr),
    staleTime: 60_000,
  })

  const kanaal: BevestigingKanaal = bepaalBevestigingKanaal(
    'edi',
    config ? { transus_actief: config.transus_actief, orderbev_uit: config.orderbev_uit } : null,
  )

  /**
   * Zet de gekozen afleverdatum vast en bevestig via het juiste kanaal.
   * @param gekozenDatum ISO-datum (YYYY-MM-DD) van de bevestigde leverweek.
   */
  async function bevestig(gekozenDatum: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      // 1. Bevestigde afleverdatum vastzetten (operator-keuze) — de orderbev
      //    leest deze datum (mig 309-gedrag).
      const { error: updErr } = await supabase
        .from('orders')
        .update({ afleverdatum: gekozenDatum })
        .eq('id', orderId)
      if (updErr) throw updErr

      // 2. Kanaal-dispatch.
      if (kanaal === 'edi') {
        if (!bericht?.payload_parsed) {
          throw new Error('Geen bron-EDI-bericht gevonden voor deze order')
        }
        await bevestigOrderViaEdi(
          orderId,
          bericht.id,
          bericht.payload_parsed as unknown as KarpiOrder,
          KARPI_GLN_DEFAULT,
          { isTest: bericht.is_test ?? false },
        )
      } else {
        // kanaal 'email': partner wil geen EDI-orderbev. Zet de leverweek-gate
        // administratief (edi_bevestigd_op) zodat het "Te bevestigen"-chip
        // sluit. De orderbev-e-mail gaat via de universele "Bevestig order"-knop
        // (BevestigOrderDialog met sluitEdiGate=true) — die handelt het mail-pad
        // af nadat de operator het e-mailadres bevestigt.
        await bevestigOrderZonderEdiBericht(orderId)
      }

      // 3. Verfris order-detail + overzicht + tellingen.
      qc.invalidateQueries({ queryKey: ['orders', orderId] })
      qc.invalidateQueries({ queryKey: ['order', orderId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders', 'status-counts'] })
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
      qc.invalidateQueries({ queryKey: ['edi-inkomend-voor-order', orderId] })
      qc.invalidateQueries({ queryKey: ['edi-uitgaand-voor-order', orderId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setBusy(false)
    }
  }

  return {
    kanaal,
    bericht,
    isLoading: berichtLoading || configLoading,
    configError,
    busy,
    error,
    bevestig,
  }
}
