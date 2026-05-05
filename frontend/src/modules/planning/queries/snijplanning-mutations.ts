import { supabase } from '../client'
import type { SnijplanStatus } from '@/lib/types/productie'

export interface SnijplanFormData {
  order_regel_id: number
  rol_id?: number
  snij_lengte_cm: number
  snij_breedte_cm: number
  prioriteit?: number
  planning_week?: number
  planning_jaar?: number
  positie_x_cm?: number
  positie_y_cm?: number
}

/** Create a new snijplan with auto-generated scancode */
export async function createSnijplan(data: SnijplanFormData) {
  const { data: result, error } = await supabase
    .from('snijplannen')
    .insert({
      order_regel_id: data.order_regel_id,
      rol_id: data.rol_id ?? null,
      snij_lengte_cm: data.snij_lengte_cm,
      snij_breedte_cm: data.snij_breedte_cm,
      prioriteit: data.prioriteit ?? 5,
      planning_week: data.planning_week ?? null,
      planning_jaar: data.planning_jaar ?? null,
      positie_x_cm: data.positie_x_cm ?? null,
      positie_y_cm: data.positie_y_cm ?? null,
      status: 'Gepland' as SnijplanStatus,
    })
    .select('id, snijplan_nr, scancode')
    .single()

  if (error) throw error
  return result as { id: number; snijplan_nr: string; scancode: string }
}

/** Update snijplan status */
export async function updateSnijplanStatus(id: number, status: SnijplanStatus) {
  const updateData: Record<string, unknown> = { status }

  // Auto-set gesneden_datum when marking as Gesneden
  if (status === 'Gesneden') {
    updateData.gesneden_datum = new Date().toISOString().split('T')[0]
    updateData.gesneden_op = new Date().toISOString()
  }

  const { error } = await supabase
    .from('snijplannen')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

/** Batch update status for multiple snijplannen */
export async function batchUpdateSnijplanStatus(ids: number[], status: SnijplanStatus) {
  const updateData: Record<string, unknown> = { status }

  if (status === 'Gesneden') {
    updateData.gesneden_datum = new Date().toISOString().split('T')[0]
    updateData.gesneden_op = new Date().toISOString()
  }

  const { error } = await supabase
    .from('snijplannen')
    .update(updateData)
    .in('id', ids)

  if (error) throw error
}

/** Assign a roll to a cutting plan */
export async function assignRolToSnijplan(snijplanId: number, rolId: number) {
  const { error } = await supabase
    .from('snijplannen')
    .update({ rol_id: rolId })
    .eq('id', snijplanId)

  if (error) throw error
}

/** Approve snijvoorstel: keur_snijvoorstel_goed zet status op 'Gepland' en
 *  wijst rol toe. No-op helper voor backwards-compat. */
export async function approveSnijvoorstel(_snijplanIds: number[]) {
  // Status wordt gezet door keur_snijvoorstel_goed RPC (migratie 086).
}
