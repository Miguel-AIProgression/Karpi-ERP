import { supabase } from '../client'

export interface EmailBijlage {
  filename: string
  bucket: string
  path: string
}

export interface VerstuurdeEmail {
  id: number
  order_id: number
  factuur_id: number | null
  soort: 'factuur' | 'orderbevestiging'
  onderwerp: string
  verzonden_aan: string
  verzonden_op: string
  /** NULL = inhoud niet bewaard (mail verstuurd vóór mig 366). */
  html: string | null
  bijlagen: EmailBijlage[]
}

export async function fetchEmailsVoorOrder(orderId: number): Promise<VerstuurdeEmail[]> {
  const { data, error } = await supabase
    .from('verstuurde_emails')
    .select('id, order_id, factuur_id, soort, onderwerp, verzonden_aan, verzonden_op, html, bijlagen')
    .eq('order_id', orderId)
    .order('verzonden_op', { ascending: false })
  if (error) throw error
  return (data ?? []) as VerstuurdeEmail[]
}

export async function getEmailBijlageSignedUrl(bijlage: EmailBijlage): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bijlage.bucket)
    .createSignedUrl(bijlage.path, 600)
  if (error) throw error
  return data.signedUrl
}
