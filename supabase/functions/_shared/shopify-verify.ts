// Shopify webhook HMAC-SHA256 verificatie.
//
// Shopify ondertekent elke webhook met HMAC-SHA256 over de raw body,
// base64-encoded in de `X-Shopify-Hmac-Sha256` header.
// Zie: https://shopify.dev/docs/apps/build/webhooks/secure/verify-webhooks

/**
 * Verifieert de Shopify webhook signature.
 * `secret` = de webhook secret die Shopify toont bij het aanmaken van de webhook
 * (of de `client_secret` van de custom app).
 */
export async function verifyShopifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))

  // Constante-tijd vergelijking om timing-aanvallen te voorkomen
  return timingSafeEqual(computed, signatureHeader)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
