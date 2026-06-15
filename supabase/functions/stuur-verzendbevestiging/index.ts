// Supabase Edge Function: stuur-verzendbevestiging
//
// Karpi stuurt zélf een verzendbevestiging mét pakbon-PDF voor elke verzonden
// zending. De track & trace-mail komt van de vervoerder (HST/Verhoek) — die
// kunnen we geen pakbon meegeven — dus dit is een eigen Karpi-mail naar het
// afleveradres (zendingen.afl_email, mig 365). Een bundel-zending (meerdere
// orders, zelfde debiteur+adres) krijgt één mail met één pakbon; per betrokken
// order wordt één rij in verstuurde_emails gelogd (zichtbaar op order-detail).
//
// Twee modi:
//   POST { zending_nr } | { order_id }  — gericht (één zending resp. de zending(en) van een order)
//   POST {}                             — sweep: alle Verzonden orders met een zending zonder verzendbevestiging
//
// Auth: ?token=<CRON_TOKEN> (zelfde patroon als bouw-verzendbericht-edi).
// Idempotentie: zendingen.verzendbevestiging_verstuurd_op (mig 401).
//
// Spiegelt: stuur-orderbevestiging (mail + audit) + bouw-verzendbericht-edi (sweep).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchPakbonZending } from '../_shared/pakbon/fetch.ts'
import { bouwPakbonDocument } from '../_shared/pakbon/pakbon-document.ts'
import { genereerPakbonPDF } from '../_shared/pakbon/pakbon-pdf.ts'
import { fetchBedrijfMetLogo } from '../_shared/pakbon/bedrijf.ts'
import { resolveTrackTrace } from '../_shared/verzendbevestiging/track-trace.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_GRAPH_TENANT_ID = Deno.env.get('MS_GRAPH_TENANT_ID')!
const MS_GRAPH_CLIENT_ID = Deno.env.get('MS_GRAPH_CLIENT_ID')!
const MS_GRAPH_CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!
const FROM_EMAIL = Deno.env.get('FACTUUR_FROM_EMAIL') ?? Deno.env.get('ORDERBEVESTIGING_FROM_EMAIL')!
const REPLY_TO = Deno.env.get('FACTUUR_REPLY_TO') ?? FROM_EMAIL

// Sweep-venster: verzonden orders niet alsnog mailen bij latere activatie.
const SWEEP_VENSTER_DAGEN = 7

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// deno-lint-ignore no-explicit-any
type Sb = any

interface ZendingControle {
  id: number
  zending_nr: string
  afl_email: string | null
  vervoerder_code: string | null
  track_trace: string | null
  verzendbevestiging_verstuurd_op: string | null
}

interface VerwerkResult {
  zending_nr: string
  status: 'verstuurd' | 'al_verstuurd' | 'geen_email' | 'dropship_overgeslagen' | 'fout'
  verstuurd_naar?: string
  error?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const expectedToken = Deno.env.get('CRON_TOKEN')
  if (!expectedToken || token !== expectedToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  let body: { zending_nr?: string; order_id?: number; force?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // geen body → sweep
  }

  try {
    const { bedrijf, logo } = await fetchBedrijfMetLogo(sb)
    const ctx = { sb, bedrijf, logo, force: body.force === true }

    // Gericht op één zending
    if (body.zending_nr) {
      const z = await haalZendingControle(sb, body.zending_nr)
      if (!z) return json(404, { error: `Zending ${body.zending_nr} niet gevonden` })
      return json(200, { verwerkt: 1, results: [await verwerkZending(ctx, z)] })
    }

    // Gericht op een order → al z'n zendingen
    if (body.order_id) {
      const zendingNrs = await zendingNrsVoorOrders(sb, [body.order_id])
      const results: VerwerkResult[] = []
      for (const nr of zendingNrs) {
        const z = await haalZendingControle(sb, nr)
        if (z) results.push(await verwerkZending(ctx, z))
      }
      return json(200, { verwerkt: results.length, results })
    }

    // Sweep
    const kandidaten = await zoekKandidaten(sb)
    if (!kandidaten.ok) return json(500, { error: kandidaten.error })
    const results: VerwerkResult[] = []
    for (const z of kandidaten.zendingen) {
      results.push(await verwerkZending(ctx, z))
    }
    return json(200, { verwerkt: results.length, results })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})

// ── Kandidaten ───────────────────────────────────────────────────────────────

interface KandidatenResult {
  ok: boolean
  zendingen: ZendingControle[]
  error?: string
}

async function zoekKandidaten(sb: Sb): Promise<KandidatenResult> {
  const sweepVanaf = new Date(Date.now() - SWEEP_VENSTER_DAGEN * 24 * 60 * 60 * 1000).toISOString()

  // Verzonden orders binnen het venster.
  const { data: orders, error: ordErr } = await sb
    .from('orders')
    .select('id')
    .eq('status', 'Verzonden')
    .gte('verzonden_at', sweepVanaf)
  if (ordErr) return { ok: false, zendingen: [], error: `Fetch orders: ${ordErr.message}` }
  if (!orders || orders.length === 0) return { ok: true, zendingen: [] }

  const orderIds = (orders as Array<{ id: number }>).map((o) => o.id)
  const zendingNrs = await zendingNrsVoorOrders(sb, orderIds)
  if (zendingNrs.length === 0) return { ok: true, zendingen: [] }

  // Zendingen die nog geen verzendbevestiging hebben.
  const { data: zendingen, error: zErr } = await sb
    .from('zendingen')
    .select('id, zending_nr, afl_email, vervoerder_code, track_trace, verzendbevestiging_verstuurd_op')
    .in('zending_nr', zendingNrs)
    .is('verzendbevestiging_verstuurd_op', null)
  if (zErr) return { ok: false, zendingen: [], error: `Fetch zendingen: ${zErr.message}` }

  return { ok: true, zendingen: (zendingen ?? []) as ZendingControle[] }
}

async function zendingNrsVoorOrders(sb: Sb, orderIds: number[]): Promise<string[]> {
  const { data, error } = await sb
    .from('zending_orders')
    .select('zendingen ( zending_nr )')
    .in('order_id', orderIds)
  if (error || !data) return []
  const nrs = new Set<string>()
  for (const row of data as Array<{ zendingen: { zending_nr: string } | null }>) {
    if (row.zendingen?.zending_nr) nrs.add(row.zendingen.zending_nr)
  }
  return Array.from(nrs)
}

async function haalZendingControle(sb: Sb, zendingNr: string): Promise<ZendingControle | null> {
  const { data, error } = await sb
    .from('zendingen')
    .select('id, zending_nr, afl_email, vervoerder_code, track_trace, verzendbevestiging_verstuurd_op')
    .eq('zending_nr', zendingNr)
    .maybeSingle()
  if (error || !data) return null
  return data as ZendingControle
}

// ── Verwerking per zending ───────────────────────────────────────────────────

interface VerwerkCtx {
  sb: Sb
  // deno-lint-ignore no-explicit-any
  bedrijf: any
  // deno-lint-ignore no-explicit-any
  logo: any
  force: boolean
}

async function verwerkZending(ctx: VerwerkCtx, z: ZendingControle): Promise<VerwerkResult> {
  const { sb } = ctx
  try {
    if (z.verzendbevestiging_verstuurd_op && !ctx.force) {
      return { zending_nr: z.zending_nr, status: 'al_verstuurd' }
    }
    // Betrokken orders (voor de dropship-check + het loggen per order).
    const betrokkenOrders = await betrokkenOrdersVoorZending(sb, z.zending_nr)

    // Dropship-uitsluiting (harde regel): bij dropship is afl_email de
    // CONSUMENT (mig 370) — de pakbon mag daar nooit heen (de winkel is de
    // klant, niet de eindontvanger). De vervoerder-T&T naar de consument is wél
    // gewenst, maar die komt van HST/Verhoek, niet van ons. We zetten de gate
    // zodat de sweep deze zending niet elke run opnieuw evalueert.
    if (await isDropshipZending(sb, betrokkenOrders.map((o) => o.id))) {
      await sb.from('zendingen')
        .update({ verzendbevestiging_verstuurd_op: new Date().toISOString() })
        .eq('id', z.id)
      return { zending_nr: z.zending_nr, status: 'dropship_overgeslagen' }
    }

    const aflEmail = (z.afl_email ?? '').trim()
    if (!aflEmail) {
      // Geen afleveradres-e-mail (bewust geen factuur-adres-fallback, mig 365).
      return { zending_nr: z.zending_nr, status: 'geen_email' }
    }

    // Pakbon-PDF (single source, dezelfde renderer als de download).
    const pakbonZending = await fetchPakbonZending(sb, z.zending_nr)
    const doc = bouwPakbonDocument(pakbonZending)
    const pdfBytes = await genereerPakbonPDF(doc, ctx.bedrijf, ctx.logo)

    // Track & trace (best-effort).
    const tt = await resolveTrackTrace(sb, z)

    const onderwerp = `Verzendbevestiging ${z.zending_nr}`
    const html = bouwMailHtml({ bedrijf: ctx.bedrijf, doc, tt, orderNrs: betrokkenOrders.map((o) => o.order_nr) })
    const pdfFilename = `Pakbon-${z.zending_nr}.pdf`

    let sendOk = false
    let sendFout: string | null = null
    try {
      await sendFactuurEmail({
        tenantId: MS_GRAPH_TENANT_ID,
        clientId: MS_GRAPH_CLIENT_ID,
        clientSecret: MS_GRAPH_CLIENT_SECRET,
        from: FROM_EMAIL,
        to: aflEmail,
        replyTo: REPLY_TO,
        subject: onderwerp,
        html,
        attachments: [{ filename: pdfFilename, content: pdfBytes }],
      })
      sendOk = true
    } catch (e) {
      sendFout = e instanceof Error ? e.message : String(e)
    }

    // Diagnostische audit (best-effort, PDF-bytes niet meegelogd).
    const auditPayload = {
      from: FROM_EMAIL,
      to: aflEmail,
      subject: onderwerp,
      zending_nr: z.zending_nr,
      orders: betrokkenOrders.map((o) => o.order_nr),
      track_trace: tt?.nummer ?? null,
      attachments: [{ filename: pdfFilename, contentType: 'application/pdf', bytes: pdfBytes.length }],
    }
    await logExternePayload(sb, {
      kanaal: 'verzendbevestiging',
      richting: 'out',
      raw: JSON.stringify(auditPayload),
      json: { request: auditPayload, ok: sendOk },
      bron: 'graph',
      externeId: z.zending_nr,
      status: sendOk ? 'verwerkt' : 'fout',
      orderId: betrokkenOrders[0]?.id ?? null,
      fout: sendFout,
    })

    if (!sendOk) return { zending_nr: z.zending_nr, status: 'fout', error: sendFout ?? 'mail mislukt' }

    // PDF bewaren + per order in de e-mailtijdlijn loggen (best-effort).
    try {
      const pdfPath = `${z.zending_nr}/${pdfFilename}`
      const { error: upErr } = await sb.storage
        .from('verzendbevestigingen')
        .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true })
      const bijlagen = upErr ? [] : [{ filename: pdfFilename, bucket: 'verzendbevestigingen', path: pdfPath }]
      if (upErr) console.warn(`[stuur-verzendbevestiging] PDF-upload mislukt: ${upErr.message}`)

      for (const o of betrokkenOrders) {
        const { error: logErr } = await sb.from('verstuurde_emails').insert({
          order_id: o.id,
          soort: 'verzendbevestiging',
          onderwerp,
          verzonden_aan: aflEmail,
          html,
          bijlagen,
        })
        if (logErr) console.warn(`[stuur-verzendbevestiging] e-mail-log order ${o.id} mislukt: ${logErr.message}`)
      }
    } catch (err) {
      console.warn(`[stuur-verzendbevestiging] log/upload exception: ${err}`)
    }

    // Idempotentie-gate sluiten.
    await sb.from('zendingen')
      .update({ verzendbevestiging_verstuurd_op: new Date().toISOString() })
      .eq('id', z.id)

    return { zending_nr: z.zending_nr, status: 'verstuurd', verstuurd_naar: aflEmail }
  } catch (e) {
    return { zending_nr: z.zending_nr, status: 'fout', error: e instanceof Error ? e.message : String(e) }
  }
}

/** TRUE als één van de betrokken orders een dropship-order is (single source:
 *  SQL-predicaat is_dropship_order, mig 370). */
async function isDropshipZending(sb: Sb, orderIds: number[]): Promise<boolean> {
  for (const id of orderIds) {
    try {
      const { data } = await sb.rpc('is_dropship_order', { p_order_id: id })
      if (data === true) return true
    } catch {
      // RPC niet beschikbaar — niet blokkeren, behandel als niet-dropship.
    }
  }
  return false
}

async function betrokkenOrdersVoorZending(sb: Sb, zendingNr: string): Promise<Array<{ id: number; order_nr: string }>> {
  const { data, error } = await sb
    .from('zending_orders')
    .select('orders ( id, order_nr ), zendingen!inner ( zending_nr )')
    .eq('zendingen.zending_nr', zendingNr)
  if (error || !data) return []
  const out: Array<{ id: number; order_nr: string }> = []
  const seen = new Set<number>()
  for (const row of data as Array<{ orders: { id: number; order_nr: string } | null }>) {
    const o = row.orders
    if (o && !seen.has(o.id)) {
      seen.add(o.id)
      out.push(o)
    }
  }
  return out
}

// ── Mail-HTML (NL, V1) ───────────────────────────────────────────────────────

interface MailHtmlArgs {
  // deno-lint-ignore no-explicit-any
  bedrijf: any
  // deno-lint-ignore no-explicit-any
  doc: any
  tt: { nummer: string; url: string | null } | null
  orderNrs: string[]
}

function bouwMailHtml({ bedrijf, doc, tt, orderNrs }: MailHtmlArgs): string {
  const ordersTekst = orderNrs.length > 0 ? orderNrs.join(', ') : doc.pakbonnr
  const ttBlok = tt
    ? `<p><strong>Track &amp; trace:</strong> ${
      tt.url ? `<a href="${tt.url}">${tt.nummer}</a>` : tt.nummer
    }</p>`
    : ''
  const aflRegels = (doc.afleveradres as string[]).map((r) => escapeHtml(r)).join('<br>')

  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; color: #333;">
  <p>Beste klant,</p>
  <p>Uw bestelling is verzonden. Bijgevoegd vindt u de pakbon van zending
     <strong>${escapeHtml(doc.pakbonnr)}</strong> (order ${escapeHtml(ordersTekst)}).</p>
  ${ttBlok}
  <p>
    <strong>Afleveradres:</strong><br>
    ${aflRegels}
  </p>
  <p>${doc.kolli} collo(s)${doc.totaalGewichtKg > 0 ? `, ${formatKg(doc.totaalGewichtKg)} kg` : ''}.</p>
  <p>Met vriendelijke groet,<br><strong>${escapeHtml(bedrijf.bedrijfsnaam ?? 'Karpi')}</strong></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 11px; color: #999;">
    ${escapeHtml(bedrijf.adres ?? '')}, ${escapeHtml(bedrijf.postcode ?? '')} ${escapeHtml(bedrijf.plaats ?? '')}
    ${bedrijf.website ? `| ${escapeHtml(bedrijf.website)}` : ''}
  </p>
</div>`
}

function formatKg(v: number): string {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
