// Supabase Edge Function: poll-email-orders
//
// Leest ongelezen e-mails uit bestellingen@karpi.nl (Microsoft 365) via
// Microsoft Graph API. Per e-mail: tekst + PDF-bijlagen → parse-klant-po →
// create_webshop_order met status='Concept'. Idempotent op Graph message-ID.
//
// Aanroep: POST (geen body vereist) — typisch vanuit pg_cron elke 5 minuten.
// Auth: CRON_TOKEN header OF supabase service-role JWT.
//
// Vereiste Supabase secrets:
//   MS_TENANT_ID       — Azure AD tenant ID van karpi.nl
//   MS_CLIENT_ID       — Azure app (client) ID
//   MS_CLIENT_SECRET   — Azure app client secret
//   MS_MAILBOX         — bestellingen@karpi.nl
//   CRON_TOKEN         — gedeeld met pg_cron voor authenticatie

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_TENANT_ID         = Deno.env.get('MS_TENANT_ID')!
const MS_CLIENT_ID         = Deno.env.get('MS_CLIENT_ID')!
const MS_CLIENT_SECRET     = Deno.env.get('MS_CLIENT_SECRET')!
const MS_MAILBOX           = Deno.env.get('MS_MAILBOX') ?? 'bestellingen@karpi.nl'
const CRON_TOKEN           = Deno.env.get('CRON_TOKEN') ?? ''
const PARSE_PO_URL         = `${SUPABASE_URL}/functions/v1/parse-klant-po`

// Meldingsmap voor verwerkte berichten (wordt aangemaakt als die niet bestaat)
const VERWERKT_MAP = 'RugFlow-verwerkt'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Microsoft Graph OAuth2 client credentials ────────────────────────────────

async function getMsAccessToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    },
  )
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`MS Graph token-fout: ${res.status} ${t}`)
  }
  const data = await res.json()
  return data.access_token as string
}

// ── Graph API helpers ────────────────────────────────────────────────────────

async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph GET ${path}: ${res.status} ${t.slice(0, 200)}`)
  }
  return res.json()
}

async function graphPatch(token: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    console.warn(`Graph PATCH ${path}: ${res.status} ${t.slice(0, 200)}`)
  }
}

async function graphPost(token: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Graph POST ${path}: ${res.status} ${t.slice(0, 200)}`)
  }
  return res.json()
}

// ── Mail utilities ───────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Zoek of maak de RugFlow-verwerkt map aan, geef de map-ID terug
async function getOrCreateMap(token: string): Promise<string> {
  const mailboxPath = `/users/${MS_MAILBOX}/mailFolders`
  const res = await graphGet(token, `${mailboxPath}?$filter=displayName eq '${VERWERKT_MAP}'`) as { value: Array<{ id: string }> }
  if (res.value.length > 0) return res.value[0].id
  const created = await graphPost(token, mailboxPath, { displayName: VERWERKT_MAP }) as { id: string }
  return created.id
}

// ── Hoofd-verwerking per e-mail ───────────────────────────────────────────────

async function verwerkEmail(
  token: string,
  msg: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  verwerktMapId: string,
): Promise<{ order_nr: string | null; actie: string }> {
  const msgId    = msg.id as string
  const subject  = (msg.subject as string | null) ?? '(geen onderwerp)'
  const bodyObj  = msg.body as { contentType: string; content: string }
  const bodyText = bodyObj.contentType === 'html' ? htmlToText(bodyObj.content) : bodyObj.content

  // 1. Idempotentie: order al aangemaakt?
  const { data: bestaand } = await supabase
    .from('orders')
    .select('order_nr')
    .eq('bron_systeem', 'email')
    .eq('bron_order_id', msgId)
    .limit(1)

  if (bestaand && bestaand.length > 0) {
    return { order_nr: bestaand[0].order_nr, actie: 'overgeslagen (al verwerkt)' }
  }

  // 2. PDF-bijlagen ophalen (eerste PDF volstaat)
  let pdfBase64: string | undefined
  const bijlagenRes = await graphGet(
    token,
    `/users/${MS_MAILBOX}/messages/${msgId}/attachments?$filter=contentType eq 'application/pdf'`,
  ) as { value: Array<{ contentBytes: string; name: string }> }

  if (bijlagenRes.value.length > 0) {
    pdfBase64 = bijlagenRes.value[0].contentBytes
  }

  // 3. Parse via parse-klant-po
  const parseBody: Record<string, string> = {
    email_body:    bodyText,
    email_subject: subject,
  }
  if (pdfBase64) parseBody.pdf_base64 = pdfBase64

  const parseRes = await fetch(PARSE_PO_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
    },
    body: JSON.stringify(parseBody),
  })
  if (!parseRes.ok) {
    const err = await parseRes.text()
    throw new Error(`parse-klant-po fout: ${parseRes.status} ${err.slice(0, 200)}`)
  }
  const { match } = await parseRes.json() as { match: Record<string, unknown> }

  // 4. Order aanmaken als Concept
  const vandaag     = new Date().toISOString().slice(0, 10)
  const afleverdatum = match.afleverdatum as string | null ?? vandaag

  const header = {
    debiteur_nr:     (match.debiteur_nr as number | null) ?? null,
    klant_referentie: (match.klant_referentie as string | null) ?? subject,
    orderdatum:      vandaag,
    afleverdatum,
    afl_naam:        (match.afl_naam as string | null) ?? null,
    afl_adres:       (match.afl_adres as string | null) ?? null,
    afl_postcode:    (match.afl_postcode as string | null) ?? null,
    afl_plaats:      (match.afl_plaats as string | null) ?? null,
    afl_land:        (match.afl_land as string | null) ?? 'NL',
    fact_naam:       (match.fact_naam as string | null) ?? null,
    fact_adres:      (match.fact_adres as string | null) ?? null,
    fact_postcode:   (match.fact_postcode as string | null) ?? null,
    fact_plaats:     (match.fact_plaats as string | null) ?? null,
    fact_land:       (match.fact_land as string | null) ?? 'NL',
    opmerkingen:     null,
    bron_systeem:    'email',
    bron_shop:       MS_MAILBOX,
    bron_order_id:   msgId,
  }

  // Saniteer regels: verplichte velden krijgen een fallback
  const regels = ((match.regels as Array<Record<string, unknown>> | null) ?? []).map(r => ({
    artikelnr:              r.artikelnr ?? null,
    omschrijving:           r.omschrijving ?? (r.ruwe_omschrijving as string | null) ?? '(onbekend artikel)',
    omschrijving_2:         r.omschrijving_2 ?? null,
    orderaantal:            (r.orderaantal as number | null) ?? 1,
    te_leveren:             (r.te_leveren as number | null) ?? (r.orderaantal as number | null) ?? 1,
    prijs:                  r.prijs ?? null,
    korting_pct:            r.korting_pct ?? 0,
    bedrag:                 r.bedrag ?? null,
    gewicht_kg:             r.gewicht_kg ?? null,
    is_maatwerk:            r.is_maatwerk ?? false,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code ?? null,
    maatwerk_kleur_code:    r.maatwerk_kleur_code ?? null,
    maatwerk_lengte_cm:     r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm:    r.maatwerk_breedte_cm ?? null,
  }))

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_webshop_order', {
    p_header:          header,
    p_regels:          regels,
    p_initieel_status: 'Concept',
  })
  if (rpcErr) throw new Error(`create_webshop_order: ${rpcErr.message}`)

  const orderNr = Array.isArray(rpcResult) ? rpcResult[0]?.order_nr : null

  // 5. E-mail markeren als gelezen + verplaatsen naar RugFlow-verwerkt
  await graphPatch(token, `/users/${MS_MAILBOX}/messages/${msgId}`, { isRead: true })
  await graphPost(token, `/users/${MS_MAILBOX}/messages/${msgId}/move`, { destinationId: verwerktMapId })

  return { order_nr: orderNr, actie: 'aangemaakt' }
}

// ── Serve ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  // Alleen POST toestaan; authenticeer via CRON_TOKEN of service-role JWT
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const cronHeader = req.headers.get('x-cron-token') ?? ''
  if (cronHeader !== CRON_TOKEN && !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    return json({ error: 'MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET niet geconfigureerd' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const token        = await getMsAccessToken()
    const verwerktMapId = await getOrCreateMap(token)

    // Haal max 20 ongelezen berichten op uit inbox
    const messagesRes = await graphGet(
      token,
      `/users/${MS_MAILBOX}/mailFolders/inbox/messages?$filter=isRead eq false&$top=20&$select=id,subject,body`,
    ) as { value: Array<Record<string, unknown>> }

    const resultaten: Array<{ subject: string; order_nr: string | null; actie: string; fout?: string }> = []

    for (const msg of messagesRes.value) {
      const subject = (msg.subject as string | null) ?? '(geen onderwerp)'
      try {
        const r = await verwerkEmail(token, msg, supabase, verwerktMapId)
        resultaten.push({ subject, ...r })
        console.log(`[poll-email-orders] ${subject} → ${r.actie} ${r.order_nr ?? ''}`)
      } catch (err) {
        const fout = err instanceof Error ? err.message : String(err)
        console.error(`[poll-email-orders] FOUT ${subject}:`, fout)
        resultaten.push({ subject, order_nr: null, actie: 'fout', fout })
      }
    }

    const aangemaakt  = resultaten.filter(r => r.actie === 'aangemaakt').length
    const overgeslagen = resultaten.filter(r => r.actie.startsWith('overgeslagen')).length
    const fouten      = resultaten.filter(r => r.actie === 'fout').length

    return json({ aangemaakt, overgeslagen, fouten, details: resultaten })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[poll-email-orders] fatale fout:', message)
    return json({ error: message }, 500)
  }
})
