import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Alleen POST toegestaan' }, 405)
  }

  let body: { concept?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ongeldige JSON body' }, 400)
  }

  const { concept } = body
  if (!concept || typeof concept !== 'object') {
    return jsonResponse({ error: 'concept is verplicht' }, 400)
  }

  const c = concept as Record<string, unknown>
  if (!Array.isArray(c.regels) || c.regels.length === 0) {
    return jsonResponse({ error: 'concept.regels moet een niet-lege array zijn' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const { data, error } = await supabase.rpc('bouw_order_voorstel', { p_concept: concept })

    if (error) {
      console.error('bouw_order_voorstel RPC error:', error.message)
      return jsonResponse({ error: `DB-fout: ${error.message}` }, 500)
    }

    return jsonResponse(data, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('orders-bouw-voorstel error:', message)
    return jsonResponse({ error: `Onverwachte fout: ${message}` }, 500)
  }
})
