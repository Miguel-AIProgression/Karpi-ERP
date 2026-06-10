// Splitst een opgeslagen factuur-e-mailveld (`debiteuren.email_factuur`) dat
// één óf meerdere komma-gescheiden ontvangers kan bevatten naar losse adressen.
// Spiegelt de frontend-helper `frontend/src/lib/email-recipients.ts`
// (`splitEmailRecipients`): Deno-edge is niet door Vite importeerbaar, dus
// seam-patroon zoals `_shared/debiteur-matcher.ts` ↔ frontend `product-matcher`.

// Splitst op komma, puntkomma of whitespace; lege stukken vallen weg.
export function splitEmailRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
