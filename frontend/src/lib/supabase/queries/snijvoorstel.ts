import { supabase } from '../client'
import type { SnijvoorstelResponse, SnijvoorstelRow, SnijvoorstelPlaatsingRow, RolStatus } from '@/lib/types/productie'

/** Call the Edge Function to generate a cutting proposal */
export async function generateSnijvoorstel(
  kwaliteitCode: string,
  kleurCode: string
): Promise<SnijvoorstelResponse> {
  const { data, error } = await supabase.functions.invoke('optimaliseer-snijplan', {
    body: { kwaliteit_code: kwaliteitCode, kleur_code: kleurCode },
  })
  if (error) {
    // Extract actual error from response body (supabase-js puts Response in error.context)
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context
      if (ctx instanceof Response) {
        const body = await ctx.json()
        if (body?.error) msg = body.error
      }
    } catch { /* fallback to generic message */ }
    throw new Error(msg)
  }
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

/** Fetch the most recent goedgekeurd voorstel for a kwaliteit+kleur group.
 *  Returns voorstel + plaatsingen + rollen info, reconstructed as SnijvoorstelResponse. */
export async function fetchGoedgekeurdVoorstel(
  kwaliteitCode: string,
  kleurCode: string,
): Promise<SnijvoorstelResponse | null> {
  // Find latest approved voorstel for this group
  const { data: voorstel, error: vErr } = await supabase
    .from('snijvoorstellen')
    .select('*')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', kleurCode)
    .eq('status', 'goedgekeurd')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (vErr) throw vErr
  if (!voorstel) return null

  // Fetch plaatsingen + rol info
  const { data: plaatsingen, error: pErr } = await supabase
    .from('snijvoorstel_plaatsingen')
    .select('*, rollen!inner(id, rolnummer, lengte_cm, breedte_cm, status)')
    .eq('voorstel_id', voorstel.id)

  if (pErr) throw pErr

  // Group plaatsingen by rol
  const rolMap = new Map<number, {
    rol_id: number; rolnummer: string; rol_lengte_cm: number; rol_breedte_cm: number; rol_status: RolStatus;
    plaatsingen: Array<{ snijplan_id: number; positie_x_cm: number; positie_y_cm: number; lengte_cm: number; breedte_cm: number; geroteerd: boolean }>
  }>()

  for (const p of (plaatsingen ?? [])) {
    const rol = (p as Record<string, unknown>).rollen as { id: number; rolnummer: string; lengte_cm: number; breedte_cm: number; status: string }
    if (!rolMap.has(rol.id)) {
      rolMap.set(rol.id, {
        rol_id: rol.id, rolnummer: rol.rolnummer,
        rol_lengte_cm: rol.lengte_cm, rol_breedte_cm: rol.breedte_cm, rol_status: rol.status as RolStatus,
        plaatsingen: [],
      })
    }
    rolMap.get(rol.id)!.plaatsingen.push({
      snijplan_id: p.snijplan_id,
      positie_x_cm: p.positie_x_cm,
      positie_y_cm: p.positie_y_cm,
      lengte_cm: p.lengte_cm,
      breedte_cm: p.breedte_cm,
      geroteerd: p.geroteerd,
    })
  }

  // Build response format
  const rollen = Array.from(rolMap.values()).map((r) => {
    const gebruikte = Math.max(...r.plaatsingen.map(p => p.positie_y_cm + p.breedte_cm), 0)
    const restlengte = r.rol_lengte_cm - gebruikte
    const usedArea = r.rol_breedte_cm * gebruikte
    const pieceArea = r.plaatsingen.reduce((s, p) => s + p.lengte_cm * p.breedte_cm, 0)
    const afval = usedArea > 0 ? Math.round((1 - pieceArea / usedArea) * 1000) / 10 : 0
    return { ...r, gebruikte_lengte_cm: gebruikte, afval_percentage: afval, restlengte_cm: restlengte }
  })

  return {
    voorstel_id: voorstel.id,
    voorstel_nr: voorstel.voorstel_nr,
    rollen,
    niet_geplaatst: [],
    samenvatting: {
      totaal_stukken: voorstel.totaal_stukken,
      geplaatst: voorstel.totaal_stukken,
      niet_geplaatst: 0,
      totaal_rollen: voorstel.totaal_rollen,
      gemiddeld_afval_pct: voorstel.afval_percentage,
      totaal_m2_gebruikt: voorstel.totaal_m2_gebruikt,
      totaal_m2_afval: voorstel.totaal_m2_afval,
    },
  }
}

/** Fetch available roll capacity (m²) for a kwaliteit+kleur, including interchangeable qualities.
 *  Also includes remaining space on in_snijplan rolls. */
export async function fetchBeschikbareCapaciteit(kwaliteitCode: string, kleurCode: string) {
  // 1. Find interchangeable quality codes
  const { data: kwal } = await supabase
    .from('kwaliteiten')
    .select('code, collectie_id')
    .eq('code', kwaliteitCode)
    .maybeSingle()

  let codes = [kwaliteitCode]
  if (kwal?.collectie_id) {
    const { data: verwant } = await supabase
      .from('kwaliteiten')
      .select('code')
      .eq('collectie_id', kwal.collectie_id)
    if (verwant) codes = verwant.map(k => k.code)
  }

  // 2. kleur variants
  const kleurV = [kleurCode]
  if (!kleurCode.includes('.')) kleurV.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) kleurV.push(kleurCode.replace('.0', ''))

  // 3. Fetch rolls (beschikbaar + reststuk + in_snijplan)
  const { data: rollen, error } = await supabase
    .from('rollen')
    .select('id, kwaliteit_code, lengte_cm, breedte_cm, status')
    .in('kwaliteit_code', codes)
    .in('kleur_code', kleurV)
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])

  if (error) throw error

  // 4. For in_snijplan rolls, calculate remaining length from snijplannen positions
  const inPlanRolIds = (rollen ?? []).filter(r => r.status === 'in_snijplan').map(r => r.id)
  let usedLengthMap = new Map<number, number>()

  if (inPlanRolIds.length > 0) {
    const { data: plannen } = await supabase
      .from('snijplannen')
      .select('rol_id, positie_y_cm, lengte_cm, breedte_cm, geroteerd')
      .in('rol_id', inPlanRolIds)
      .in('status', ['Gepland', 'In productie'])

    for (const p of plannen ?? []) {
      const endY = (p.positie_y_cm ?? 0) + (p.geroteerd ? p.lengte_cm : p.breedte_cm)
      usedLengthMap.set(p.rol_id, Math.max(usedLengthMap.get(p.rol_id) ?? 0, endY))
    }
  }

  let exactM2 = 0
  let uitwisselbaarM2 = 0
  let exactRollen = 0
  let uitwisselRollen = 0

  for (const r of rollen ?? []) {
    let beschikbareLengte = r.lengte_cm
    if (r.status === 'in_snijplan') {
      const used = usedLengthMap.get(r.id) ?? 0
      beschikbareLengte = Math.max(0, r.lengte_cm - Math.ceil(used))
      if (beschikbareLengte < 50) continue // te klein om mee te tellen
    }

    const m2 = (beschikbareLengte * r.breedte_cm) / 10000
    if (r.kwaliteit_code === kwaliteitCode) {
      exactM2 += m2
      exactRollen++
    } else {
      uitwisselbaarM2 += m2
      uitwisselRollen++
    }
  }

  return {
    exactM2: Math.round(exactM2 * 10) / 10,
    uitwisselbaarM2: Math.round(uitwisselbaarM2 * 10) / 10,
    totaalM2: Math.round((exactM2 + uitwisselbaarM2) * 10) / 10,
    exactRollen,
    uitwisselRollen,
    totaalRollen: exactRollen + uitwisselRollen,
    heeftUitwisselbaar: uitwisselRollen > 0,
  }
}

/** Complete cutting of a roll: mark snijplannen as cut, create remnant */
export async function voltooiSnijplanRol(rolId: number, gesnedenDoor?: string) {
  const { data, error } = await supabase.rpc('voltooi_snijplan_rol', {
    p_rol_id: rolId,
    p_gesneden_door: gesnedenDoor ?? null,
  })
  if (error) throw error
  return data as { reststuk_id: number | null; reststuk_rolnummer: string | null; reststuk_lengte_cm: number | null }[]
}
