// Gedeelde best-effort helpers voor de rauwe-payload-audit (mig 324/325).
//
// Eén append-only vangnet (`externe_payloads`) bewaart de letterlijke payload
// van externe uitwisselingen voor diagnose — GEEN verwerkings-queue. Deze
// module is de seam (ADR-0033) zodat in- en uitgaande kanalen dezelfde
// twee-staps-API gebruiken i.p.v. de RPC's overal te dupliceren.
//
// HARDE regel: loggen mag de order-/bericht-verwerking NOOIT blokkeren —
// daarom staat alles in try/catch en is falen altijd "warn + doorgaan".
// De client-param is bewust `any`: de exacte `SupabaseClient`-generics
// verschillen per intake-functie (`ReturnType<typeof createClient>` vs. de
// geïmporteerde `SupabaseClient`) en de getypte client laat `.rpc()` voor
// niet-gegenereerde RPC-namen (`log_externe_payload` e.d.) als `never`/
// `undefined` resolven — wat een generic-mismatch door de hele keten zou
// slepen. Hetzelfde pragmatische patroon als de overige edge-functies hier.
// deno-lint-ignore no-explicit-any
type RpcClient = any

export interface LogExternePayloadArgs {
  /** Kanaal-discriminator, bv. 'shopify' | 'hst' | 'rhenus' | 'email'. */
  kanaal: string
  /** Letterlijke payload-string (request-body / order-JSON als tekst). */
  raw: string
  /** Herkomst, bv. het *.myshopify.com-domein of de vervoerder-host. */
  bron: string
  /** Externe id (Shopify order id, transport-order id, …) of null. */
  externeId: string | null
  contentType?: string | null
  headers?: Record<string, string>
  /** Geparste payload als JSON (zodat de audit doorzoekbaar is). */
  json?: unknown
}

/**
 * Schrijft een rauwe payload weg met status 'ontvangen' (inbound) en geeft het
 * rij-id terug voor de latere `markeerExternePayload`-afronding. Geeft `null`
 * terug bij elke fout — de caller mag dan gewoon doorverwerken.
 */
export async function logExternePayload(
  supabase: RpcClient,
  args: LogExternePayloadArgs,
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('log_externe_payload', {
      p_kanaal: args.kanaal,
      p_payload_raw: args.raw,
      p_bron: args.bron,
      p_externe_id: args.externeId,
      p_content_type: args.contentType ?? null,
      p_headers: args.headers ?? {},
      p_payload_json: args.json ?? null,
    })
    if (error) {
      console.warn(`[payload-audit:${args.kanaal}] insert faalde:`, error.message)
      return null
    }
    return typeof data === 'number' ? data : null
  } catch (e) {
    console.warn(`[payload-audit:${args.kanaal}] insert exception:`, e)
    return null
  }
}

/**
 * Sluit een eerder gelogde payload af op 'verwerkt' (met optioneel order_id) of
 * 'fout' (met reden). No-op bij een ontbrekend id (logging was best-effort).
 */
export async function markeerExternePayload(
  supabase: RpcClient,
  id: number | null,
  status: 'verwerkt' | 'fout',
  opts: { orderId?: number | null; fout?: string | null } = {},
): Promise<void> {
  if (!id) return
  try {
    await supabase.rpc('markeer_externe_payload_verwerkt', {
      p_id: id,
      p_status: status,
      p_order_id: opts.orderId ?? null,
      p_fout: opts.fout ?? null,
    })
  } catch (e) {
    console.warn('[payload-audit] update exception:', e)
  }
}
