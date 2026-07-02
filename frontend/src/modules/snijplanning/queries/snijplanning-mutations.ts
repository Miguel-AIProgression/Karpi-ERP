import { supabase } from '@/lib/supabase/client'
import type { SnijplanStatus } from '@/lib/types/productie'

// createSnijplan/updateSnijplanStatus zijn verwijderd (audit 2026-07-02,
// vervolg op assignRolToSnijplan): rauwe snijplannen-INSERT/UPDATE buiten de
// RPC-laag = VERR130-risicovorm. Snijplannen ontstaan via de trigger
// trg_auto_maak_snijplan en muteren via RPC's (start_snijden_rol/
// pauzeer_snijden_rol/voltooi_snijplan_rol/keur_snijvoorstel_goed/
// wijs_snijplan_handmatig_toe e.d.), niet via directe UPDATE.

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

// assignRolToSnijplan is verwijderd (audit 2026-07-02): kale rol_id-UPDATE
// zonder positie-herberekening reproduceert het VERR130-overlap-incident.
// Rol toewijzen = RPC wijs_snijplan_handmatig_toe (mig 453) via de edge
// function wijs-snijplan-handmatig-toe.

/** Approve snijvoorstel: keur_snijvoorstel_goed zet status op 'Gepland' en
 *  wijst rol toe. No-op helper voor backwards-compat. */
export async function approveSnijvoorstel(_snijplanIds: number[]): Promise<void> {
  // Status wordt gezet door keur_snijvoorstel_goed RPC (migratie 086).
  void _snijplanIds
}
