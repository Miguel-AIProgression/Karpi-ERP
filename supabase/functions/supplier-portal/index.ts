// Edge Function: supplier-portal
// Public API (no JWT) for supplier ETA portal.
//
// Routes:
//   GET  /?token=<uuid>              → returns leverancier info + all open regels
//   POST /  { email, wachtwoord }    → login; returns { token, leverancier_naam }
//   PATCH / { token, regel_id, verwacht_datum, notitie? } → update ETA
//
// Auth: token in URL param / body (validated server-side in update_regel_eta RPC).
// No Supabase JWT required — deploy with --no-verify-jwt.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const url = new URL(req.url)

  // ── GET: load portal data ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const token = url.searchParams.get('token')
    if (!token) return json({ error: 'token required' }, 400)

    const { data: lev, error: levErr } = await supabase
      .from('leveranciers')
      .select('id, naam, woonplaats, contactpersoon')
      .eq('portal_token', token)
      .eq('actief', true)
      .single()

    if (levErr || !lev) return json({ error: 'Invalid or expired portal link' }, 404)

    const { data: regels, error: regelsErr } = await supabase
      .from('openstaande_inkooporder_regels')
      .select(
        `regel_id, inkooporder_id, inkooporder_nr, order_status,
         besteldatum, leverweek, verwacht_datum, regel_verwacht_datum, order_verwacht_datum,
         regelnummer, artikelnr, karpi_code, artikel_omschrijving, product_omschrijving,
         kwaliteit_code, kleur_code,
         besteld_m, geleverd_m, te_leveren_m, eenheid,
         eta_bijgewerkt_door, eta_bijgewerkt_op, leverancier_notitie`,
      )
      .eq('leverancier_id', lev.id)
      .order('verwacht_datum', { ascending: true, nullsFirst: false })
      .order('inkooporder_nr', { ascending: true })
      .order('regelnummer', { ascending: true })

    if (regelsErr) {
      console.error('supplier-portal GET regels error', regelsErr)
      return json({ error: 'Failed to load order lines' }, 500)
    }

    const { data: eenheden } = await supabase
      .from('inkooporder_regels')
      .select('id, eenheid')
      .in('id', (regels ?? []).map((r: Record<string, unknown>) => r.regel_id as number))

    const eenheidMap = new Map<number, string>()
    for (const e of eenheden ?? []) {
      eenheidMap.set(e.id as number, e.eenheid as string)
    }

    const regelsEnriched = (regels ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      eenheid: eenheidMap.get(r.regel_id as number) ?? 'm',
    }))

    return json({
      leverancier: { id: lev.id, naam: lev.naam, woonplaats: lev.woonplaats },
      regels: regelsEnriched,
    })
  }

  // ── POST: login ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const { email, wachtwoord } = body as { email?: string; wachtwoord?: string }
    if (!email || !wachtwoord) return json({ error: 'email and wachtwoord are required' }, 400)

    const { data, error: rpcErr } = await supabase.rpc('portal_login', {
      p_email: email.trim().toLowerCase(),
      p_wachtwoord: wachtwoord,
    })

    if (rpcErr) {
      console.error('portal_login RPC error', rpcErr)
      return json({ error: 'Login failed' }, 500)
    }

    const rows = data as Array<{ portal_token: string; leverancier_naam: string }> | null
    if (!rows || rows.length === 0) {
      return json({ error: 'Invalid email or password' }, 401)
    }

    return json({ token: rows[0].portal_token, leverancier_naam: rows[0].leverancier_naam })
  }

  // ── PATCH: update ETA ──────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const { token, regel_id, verwacht_datum, notitie } = body as {
      token?: string
      regel_id?: number
      verwacht_datum?: string
      notitie?: string
    }

    if (!token || !regel_id || !verwacht_datum) {
      return json({ error: 'token, regel_id and verwacht_datum are required' }, 400)
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(verwacht_datum)) {
      return json({ error: 'verwacht_datum must be YYYY-MM-DD' }, 400)
    }

    const { error: rpcErr } = await supabase.rpc('update_regel_eta', {
      p_regel_id: regel_id,
      p_verwacht_datum: verwacht_datum,
      p_door: 'leverancier',
      p_portal_token: token,
      p_notitie: notitie ?? null,
    })

    if (rpcErr) {
      console.error('supplier-portal PATCH error', rpcErr)
      if (rpcErr.message?.includes('Ongeldig') || rpcErr.message?.includes('hoort niet')) {
        return json({ error: rpcErr.message }, 403)
      }
      return json({ error: 'Failed to update ETA' }, 500)
    }

    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
})
