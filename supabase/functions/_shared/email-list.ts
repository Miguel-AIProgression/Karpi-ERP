// Pure helpers voor het factuur-e-mailveld (`debiteuren.email_factuur`) dat
// één óf meerdere ontvangers kan bevatten. Opslag is één TEXT-kolom met de
// adressen komma-gescheiden (conventie `, ` zoals `verstuurd_naar`).
//
// Single source of truth (ADR-0033): de frontend re-exporteert dit bestand
// cross-root via `frontend/src/lib/email-recipients.ts` — niet kopiëren.
// Puur houden: geen Deno-API's, geen https-imports.

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
