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

// markeerGeannuleerd + herberekenWachtStatus volgen in tasks 1.4 + 1.5.
// Stub-typing met `unknown` zodat de test-imports in 1.4/1.5 compileren
// — de echte signaturen vervangen deze in de volgende tasks.
export async function markeerGeannuleerd(_input: unknown): Promise<void> {
  throw new Error('not implemented yet')
}
export async function herberekenWachtStatus(_input: unknown): Promise<void> {
  throw new Error('not implemented yet')
}
