// Webhook signature-verificatie voor Lightspeed eCom.
//
// Lightspeed stuurt `x-signature: <hex>` waar hex = MD5(payload + api_secret).
// Zie https://developers.lightspeedhq.com/ecom/tutorials/webhooks/

import SparkMD5 from 'https://esm.sh/spark-md5@3.0.2'

export function md5Hex(input: string): string {
  return SparkMD5.hash(input)
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function verifyLightspeedSignature(
  rawPayload: string,
  signatureHeader: string | null,
  apiSecret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = md5Hex(rawPayload + apiSecret).toLowerCase()
  const actual = signatureHeader.trim().toLowerCase()
  return constantTimeEqual(expected, actual)
}
