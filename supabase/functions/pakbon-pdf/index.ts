// Supabase Edge Function: pakbon-pdf
// Rendert de pakbon van een zending real-time als PDF en streamt de bytes terug.
// Geen DB-mutaties, geen mail — pure preview/print/download voor de UI én bron
// voor de pakbon-bijlage in stuur-verzendbevestiging.
//
// Single source: dezelfde `_shared/pakbon`-laag voedt zowel deze download als de
// verzendbevestiging-mail, zodat de geprinte en de gemailde pakbon identiek zijn.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchPakbonZending } from '../_shared/pakbon/fetch.ts'
import { bouwPakbonDocument } from '../_shared/pakbon/pakbon-document.ts'
import { genereerPakbonPDF } from '../_shared/pakbon/pakbon-pdf.ts'
import { fetchBedrijfMetLogo } from '../_shared/pakbon/bedrijf.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const url = new URL(req.url)
    let zendingNr = url.searchParams.get('zending_nr') ?? ''
    if (!zendingNr) {
      try {
        const body = await req.json()
        zendingNr = String(body?.zending_nr ?? '')
      } catch {
        // geen body — laat zendingNr leeg
      }
    }
    if (!zendingNr) return jsonError(400, 'zending_nr ontbreekt')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

    const { bedrijf, logo } = await fetchBedrijfMetLogo(supabase)

    let zending
    try {
      zending = await fetchPakbonZending(supabase, zendingNr)
    } catch (e) {
      return jsonError(404, e instanceof Error ? e.message : String(e))
    }

    const doc = bouwPakbonDocument(zending)
    const pdfBytes = await genereerPakbonPDF(doc, bedrijf, logo)

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="Pakbon-${zendingNr}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : String(err))
  }
})

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
