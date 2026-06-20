import { supabase } from '@/lib/supabase/client'

/** Fase 4: kandidaat-rol voor de handmatige-toewijzing-dropdown. */
export interface KandidaatRol {
  rol_id: number
  rolnummer: string
  breedte_cm: number
  lengte_cm: number
  status: string
  kwaliteit_code: string
  kleur_code: string
  is_exact: boolean
}

/** Compatibele, fysiek groot genoeg, nog niet fysiek onder het mes zittende
 *  rollen voor een snijplan-stuk — direct via RPC, geen edge-function nodig. */
export async function fetchKandidaatRollenVoorStuk(snijplanId: number): Promise<KandidaatRol[]> {
  const { data, error } = await supabase.rpc('kandidaat_rollen_voor_handmatige_toewijzing', {
    p_snijplan_id: snijplanId,
  })
  if (error) throw error
  return (data ?? []) as KandidaatRol[]
}

export interface WijsHandmatigToeResultaat {
  success: boolean
  reason?: string
  kwaliteit_code?: string | null
  kleur_code?: string | null
}

function parseEdgeFunctionError(error: { message: string }, ctx: unknown): Promise<string> {
  return (async () => {
    let msg = error.message
    try {
      const resp = ctx as Response
      if (resp?.json) {
        const parsed = await resp.json()
        if (parsed?.error) msg = parsed.error
        else msg = JSON.stringify(parsed)
      }
    } catch { /* fallback */ }
    return msg
  })()
}

/** Wijst een snijplan-stuk handmatig toe aan (of verplaatst het naar) een
 *  specifieke rol — de edge function bepaalt de positie op die rol (via
 *  dezelfde pure packing-helpers als de auto-planner) en vergrendelt het
 *  resultaat (is_handmatig_toegewezen=true) zodat auto-plan-groep het niet
 *  terugdraait. */
export async function wijsHandmatigToe(
  snijplanId: number,
  rolId: number,
): Promise<WijsHandmatigToeResultaat> {
  const { data, error } = await supabase.functions.invoke('wijs-snijplan-handmatig-toe', {
    body: { snijplan_id: snijplanId, rol_id: rolId },
  })
  if (error) {
    throw new Error(await parseEdgeFunctionError(error, (error as Record<string, unknown>).context))
  }
  return data as WijsHandmatigToeResultaat
}

export interface OntgrendelResultaat {
  kwaliteit_code: string
  kleur_code: string
}

/** Geeft een handmatig vergrendeld stuk weer vrij voor automatische planning. */
export async function ontgrendelHandmatigeToewijzing(snijplanId: number): Promise<OntgrendelResultaat> {
  const { data, error } = await supabase.rpc('ontgrendel_handmatige_toewijzing', {
    p_snijplan_id: snijplanId,
  })
  if (error) throw error
  const row = (data ?? [])[0] as OntgrendelResultaat | undefined
  if (!row) throw new Error('Ontgrendelen gaf geen resultaat terug')
  return row
}
