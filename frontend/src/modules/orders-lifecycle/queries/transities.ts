import { supabase } from '@/lib/supabase/client'

export interface MarkeerVerzondenInput {
  orderId: number
  actorMedewerkerId?: number | null
  actorAuthUserId?: string | null
}

export async function markeerVerzonden(input: MarkeerVerzondenInput): Promise<void> {
  const { error } = await supabase.rpc('markeer_verzonden', {
    p_order_id: input.orderId,
    p_actor_medewerker_id: input.actorMedewerkerId ?? null,
    p_actor_auth_user_id: input.actorAuthUserId ?? null,
  })
  if (error) throw new Error(error.message)
}

export interface MarkeerGeannuleerdInput {
  orderId: number
  reden: string
  actorMedewerkerId?: number | null
  actorAuthUserId?: string | null
}

export async function markeerGeannuleerd(input: MarkeerGeannuleerdInput): Promise<void> {
  const { error } = await supabase.rpc('markeer_geannuleerd', {
    p_order_id: input.orderId,
    p_reden: input.reden,
    p_actor_medewerker_id: input.actorMedewerkerId ?? null,
    p_actor_auth_user_id: input.actorAuthUserId ?? null,
  })
  if (error) throw new Error(error.message)
}
export interface BevestigConceptOrderInput { orderId: number }

export async function bevestigConceptOrder(input: BevestigConceptOrderInput): Promise<void> {
  const { error } = await supabase.rpc('bevestig_concept_order', {
    p_order_id: input.orderId,
  })
  if (error) throw new Error(error.message)
}

export interface HerberekenWachtStatusInput { orderId: number }

export async function herberekenWachtStatus(input: HerberekenWachtStatusInput): Promise<void> {
  const { error } = await supabase.rpc('herbereken_wacht_status', {
    p_order_id: input.orderId,
  })
  if (error) throw new Error(error.message)
}
