// Pure helpers voor het factuur-e-mailveld dat één óf meerdere ontvangers kan
// bevatten. Opslag in `debiteuren.email_factuur` is één TEXT-kolom met de
// adressen komma-gescheiden (conventie `, ` zoals `verstuurd_naar`).
// De edge function `factuur-verzenden` splitst dezelfde string weer op via
// `_shared/email-list.ts` (seam-spiegeling — Deno-edge niet door Vite te
// importeren).

// Splitst op komma, puntkomma of whitespace; lege stukken vallen weg.
// Bare e-mailadressen bevatten geen spaties, dus whitespace splitsen is veilig
// en vangt het geval op waarin de gebruiker adressen met een spatie scheidt.
export function splitEmailRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Bewust simpel/tolerant: één `@` met niet-lege delen en een punt in het
// domein. Strenger willen we niet zijn dan de mailserver zelf.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface EmailRecipientsParse {
  /** Genormaliseerde, komma-gescheiden string voor opslag (leeg → ''). */
  normalized: string
  emails: string[]
  invalid: string[]
}

export function parseEmailRecipients(raw: string): EmailRecipientsParse {
  const emails = splitEmailRecipients(raw)
  const invalid = emails.filter((e) => !EMAIL_RE.test(e))
  return {
    normalized: emails.join(', '),
    emails,
    invalid,
  }
}
