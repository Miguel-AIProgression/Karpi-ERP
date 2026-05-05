import { supabase } from '../client'
import type { ConfectieStatus } from '@/lib/types/productie'

/** Update confectie status with auto-set timestamps */
export async function updateConfectieStatus(id: number, status: ConfectieStatus) {
  const updateData: Record<string, unknown> = { status }

  if (status === 'In productie') {
    updateData.gestart_op = new Date().toISOString()
  }

  if (status === 'Gereed') {
    updateData.gereed_op = new Date().toISOString()
    updateData.gereed_datum = new Date().toISOString().split('T')[0]
  }

  const { error } = await supabase
    .from('confectie_orders')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

/** Scan start: set status to 'In productie', record medewerker and timestamp */
export async function scanConfectieStart(id: number, medewerker: string) {
  const { error } = await supabase
    .from('confectie_orders')
    .update({
      status: 'In productie' as ConfectieStatus,
      gestart_op: new Date().toISOString(),
      medewerker,
    })
    .eq('id', id)

  if (error) throw error
}

/** Scan gereed: set status to 'Gereed', record completion timestamps */
export async function scanConfectieGereed(id: number, medewerker: string) {
  const { error } = await supabase
    .from('confectie_orders')
    .update({
      status: 'Gereed' as ConfectieStatus,
      gereed_op: new Date().toISOString(),
      gereed_datum: new Date().toISOString().split('T')[0],
      medewerker,
    })
    .eq('id', id)

  if (error) throw error
}
