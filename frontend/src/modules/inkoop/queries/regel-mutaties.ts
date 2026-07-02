import { supabase } from '@/lib/supabase/client'
import type { InkooporderRegelInput } from './inkooporders'

/**
 * Regel-mutaties op een bestaande inkooporder (mig 602, besluit 2026-07-02).
 * Alle guards (Claim-vloer, geleverd-ondergrens, laatste-regel) leven
 * server-side; een 'Claim-vloer:'-fout betekent: opnieuw aanroepen met
 * vrijgeven=true nadat de operator expliciet bevestigd heeft.
 */

export function isClaimVloerFout(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Claim-vloer:')
}

export async function voegInkooporderRegelToe(
  inkooporderId: number,
  regel: Omit<InkooporderRegelInput, 'regelnummer'>,
): Promise<number> {
  const { data, error } = await supabase.rpc('voeg_inkooporder_regel_toe', {
    p_inkooporder_id: inkooporderId,
    p_regel: {
      artikelnr: regel.artikelnr,
      karpi_code: regel.karpi_code ?? null,
      artikel_omschrijving: regel.artikel_omschrijving ?? null,
      inkoopprijs_eur: regel.inkoopprijs_eur ?? null,
      besteld_m: regel.besteld_m,
      eenheid: regel.eenheid ?? 'm',
    },
  })
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function wijzigInkooporderRegel(opts: {
  regelId: number
  besteld?: number | null
  inkoopprijsEur?: number | null
  vrijgeven?: boolean
}): Promise<void> {
  const { error } = await supabase.rpc('wijzig_inkooporder_regel', {
    p_regel_id: opts.regelId,
    p_besteld: opts.besteld ?? null,
    p_inkoopprijs_eur: opts.inkoopprijsEur ?? null,
    p_vrijgeven: opts.vrijgeven ?? false,
  })
  if (error) throw new Error(error.message)
}

export async function annuleerInkooporderRegel(
  regelId: number,
  vrijgeven = false,
): Promise<void> {
  const { error } = await supabase.rpc('annuleer_inkooporder_regel', {
    p_regel_id: regelId,
    p_vrijgeven: vrijgeven,
  })
  if (error) throw new Error(error.message)
}

export async function verwijderInkooporderRegel(
  regelId: number,
  vrijgeven = false,
): Promise<void> {
  const { error } = await supabase.rpc('verwijder_inkooporder_regel', {
    p_regel_id: regelId,
    p_vrijgeven: vrijgeven,
  })
  if (error) throw new Error(error.message)
}
