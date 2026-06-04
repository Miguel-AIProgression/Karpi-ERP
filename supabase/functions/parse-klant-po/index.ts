// Supabase Edge Function: parse-klant-po
// Parseert een klant-PO-PDF: Claude-extractie + deterministische match-RPC.
// verify_jwt = false (zie config.toml) — gebruikt SERVICE_ROLE voor DB.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildAnthropicRequest, buildAnthropicRequestFromEmail, parsePoExtractie } from '../_shared/po-extract.ts'

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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY ontbreekt in de functie-omgeving' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // ---- Request-body (malformed body = 400, niet 500) ----
  let body: { pdf_base64?: string; bestandsnaam?: string; email_body?: string; email_subject?: string }
  try {
    body = await req.json() as { pdf_base64?: string; bestandsnaam?: string; email_body?: string; email_subject?: string }
  } catch {
    return jsonResponse({ error: 'Ongeldige request-body (verwacht JSON)' }, 400)
  }
  if (!body.pdf_base64 && !body.email_body) {
    return jsonResponse({ error: 'pdf_base64 of email_body is verplicht' }, 400)
  }
  const bestandsnaam = body.bestandsnaam ?? 'order.pdf'

  try {
    // ---- 1. Claude-extractie ----
    const anthropicReq = body.email_body
      ? buildAnthropicRequestFromEmail(body.email_body, body.email_subject ?? '', body.pdf_base64)
      : buildAnthropicRequest(body.pdf_base64!, bestandsnaam)
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicReq),
    })
    if (!aiRes.ok) {
      const detail = await aiRes.text()
      console.error('parse-klant-po anthropic-fout:', aiRes.status, detail)
      return jsonResponse({ error: `Claude-extractie mislukt (status ${aiRes.status})`, detail }, 502)
    }

    // Niet-JSON of schema-mismatch op een 200 is een upstream-contentfout → 502.
    let extractie
    try {
      const aiJson = await aiRes.json()
      extractie = parsePoExtractie(aiJson)
    } catch (parseErr) {
      const m = parseErr instanceof Error ? parseErr.message : String(parseErr)
      console.error('parse-klant-po extractie-fout:', m)
      return jsonResponse({ error: `Claude-respons onbruikbaar: ${m}` }, 502)
    }

    // ---- 2. Deterministische match ----
    const { data: match, error: rpcErr } = await supabase.rpc('match_klant_po', {
      p_extractie: extractie,
    })
    if (rpcErr) {
      return jsonResponse({ error: `match_klant_po fout: ${rpcErr.message}` }, 500)
    }

    return jsonResponse({ extractie, match }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('parse-klant-po error:', message)
    return jsonResponse({ error: `Parse-fout: ${message}` }, 500)
  }
})
