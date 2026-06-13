import { supabase } from '../client'

export interface ShopifySyncRunStatus {
  id: number
  gestart_op: string
  afgerond_op: string | null
  status: 'lopend' | 'ok' | 'fout'
  aangemaakt: number
  overgeslagen: number
  fouten: number
  foutmelding: string | null
}

/**
 * Laatste run van de geplande Shopify-orderpoll (sync-shopify-orders-poll, mig 323).
 * Voedt de waarschuwingsbanner op het orders-overzicht — zichtbaar zodra de
 * cron uitvalt (status='fout') of stilvalt (geen recente run, want de cron
 * draait elke 10 minuten).
 */
export async function fetchLatestShopifySyncRun(): Promise<ShopifySyncRunStatus | null> {
  const { data, error } = await supabase
    .from('shopify_sync_runs')
    .select('id, gestart_op, afgerond_op, status, aangemaakt, overgeslagen, fouten, foutmelding')
    .order('gestart_op', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}
