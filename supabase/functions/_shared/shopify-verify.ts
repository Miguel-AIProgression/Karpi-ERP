/**
 * Verifieert de authenticiteit van een Shopify-webhook via HMAC-SHA256.
 *
 * Shopify stuurt een base64-gecodeerde HMAC-SHA256 signature mee in de
 * `X-Shopify-Hmac-Sha256` header, berekend over de rauwe payload body
 * met de webhook-signing-secret als sleutel.
 *
 * Referentie: https://shopify.dev/docs/apps/build/webhooks/securing/validate-webhooks
 */
export async function verifyShopifySignature(
  rawPayload: string,
  hmacHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!hmacHeader) return false

  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawPayload))
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))

    // Timing-safe vergelijking om timing-aanvallen te voorkomen
    if (computed.length !== hmacHeader.length) return false
    let diff = 0
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i)
    }
    return diff === 0
  } catch {
    return false
  }
}
