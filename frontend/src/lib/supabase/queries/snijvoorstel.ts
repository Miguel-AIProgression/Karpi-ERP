import { supabase } from '../client'
import type { SnijvoorstelResponse, SnijvoorstelRow, SnijvoorstelPlaatsingRow } from '@/lib/types/productie'

/** Call the Edge Function to generate a cutting proposal */
export async function generateSnijvoorstel(
  kwaliteitCode: string,
  kleurCode: string
): Promise<SnijvoorstelResponse> {
  const { data, error } = await supabase.functions.invoke('optimaliseer-snijplan', {
    body: { kwaliteit_code: kwaliteitCode, kleur_code: kleurCode },
  })
  if (error) throw error
  return data as SnijvoorstelResponse
}

/** Fetch a voorstel by ID with its plaatsingen */
export async function fetchSnijvoorstel(voorstelId: number) {
  const [voorstelRes, plaatsingenRes] = await Promise.all([
    supabase
      .from('snijvoorstellen')
      .select('*')
      .eq('id', voorstelId)
      .single(),
    supabase
      .from('snijvoorstel_plaatsingen')
      .select('*')
      .eq('voorstel_id', voorstelId),
  ])

  if (voorstelRes.error) throw voorstelRes.error
  if (plaatsingenRes.error) throw plaatsingenRes.error

  return {
    voorstel: voorstelRes.data as SnijvoorstelRow,
    plaatsingen: (plaatsingenRes.data ?? []) as SnijvoorstelPlaatsingRow[],
  }
}

/** Approve a voorstel via the database function */
export async function approveSnijvoorstel(voorstelId: number) {
  const { error } = await supabase.rpc('keur_snijvoorstel_goed', {
    p_voorstel_id: voorstelId,
  })
  if (error) throw error
}

/** Reject a voorstel */
export async function rejectSnijvoorstel(voorstelId: number) {
  const { error } = await supabase.rpc('verwerp_snijvoorstel', {
    p_voorstel_id: voorstelId,
  })
  if (error) throw error
}
