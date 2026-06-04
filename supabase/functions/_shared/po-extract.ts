// Pure extractie-laag voor klant-PO parsing.
// Geen netwerk-IO hier — alleen request-bouw + respons-parsing/-validatie,
// zodat dit deterministisch te testen is (zie po-extract.test.ts).

/** Ruwe, vormvrije extractie zoals Claude die teruggeeft. Geen koppeling. */
export interface PoAfzender {
  naam: string | null
  email: string | null
  btw_nummer: string | null
  kvk: string | null
  adres: string | null
}
export interface PoAdres {
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
}
export interface PoRuweRegel {
  aantal: number | null
  ruwe_omschrijving: string | null
  kwaliteit_tekst: string | null
  kleur_tekst: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm_tekst: string | null
  klant_artikelnr: string | null
  prijs: number | null
  korting_pct: number | null
}
export interface PoRuwExtractie {
  afzender: PoAfzender
  klant_referentie: string | null
  leverdatum_tekst: string | null
  spoed: boolean
  afleveradres: PoAdres | null
  factuuradres: PoAdres | null
  regels: PoRuweRegel[]
}

// Sonnet is ruim voldoende voor gestructureerde extractie en goedkoper per
// call — kosten doen er hier toe (1 call per expliciete klik).
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

const SYSTEM_PROMPT = `Je bent een extractie-engine voor inkooporders/bestelbonnen van een tapijtgroothandel (Karpi).
Je krijgt één PDF van een klant-bestelling. Haal UITSLUITEND de letterlijk aanwezige gegevens eruit.
Verzin of koppel NIETS — geen artikelnummers, geen kwaliteitscodes. Laat onbekend = null.

Belangrijk:
- Een "klantnummer"/"leverancier nr." op de bon verwijst naar KARPI in het systeem van de klant — NIET overnemen als afzender-id.
- afzender = het bedrijf dat de bestelling plaatst (logo/briefhoofd/BTW/e-mail).
- klant_referentie = ordernummer/onze-referentie; voeg een eventuele commissienaam toe als "<ordernr> | Commissie <naam>".
- leverdatum_tekst = letterlijke leverweek/-datum-tekst ("29-2026", "ASAP", "zo snel mogelijk") of null.
- spoed = true bij "SPOED", "SUPER SPOED", "Urgent", "ASAP", "zo snel/spoedig mogelijk".
- Per regel: aantal, ruwe_omschrijving (volledige regeltekst), kwaliteit_tekst (productnaam zoals PLUSH/Luxury/Cavaro/Vernon), kleur_tekst (zoals "13", "Plush 11", "Iron Grey 15"), lengte_cm/breedte_cm uit de maat (bv. 160 x 230 → 160/230), vorm_tekst (Rechthoekig/Rond/...), klant_artikelnr (alleen als de klant een eigen artikelnr noemt), prijs (eenheidsprijs), korting_pct.

Antwoord met UITSLUITEND één JSON-object, exact dit schema, geen uitleg:
{"afzender":{"naam":string|null,"email":string|null,"btw_nummer":string|null,"kvk":string|null,"adres":string|null},"klant_referentie":string|null,"leverdatum_tekst":string|null,"spoed":boolean,"afleveradres":{"naam":string|null,"adres":string|null,"postcode":string|null,"plaats":string|null,"land":string|null}|null,"factuuradres":{...zelfde...}|null,"regels":[{"aantal":number|null,"ruwe_omschrijving":string|null,"kwaliteit_tekst":string|null,"kleur_tekst":string|null,"lengte_cm":number|null,"breedte_cm":number|null,"vorm_tekst":string|null,"klant_artikelnr":string|null,"prijs":number|null,"korting_pct":number|null}]}`

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  messages: Array<{ role: 'user'; content: unknown[] }>
}

/** Bouwt de Anthropic Messages-request voor een PDF. Prompt-caching op het vaste system-blok. */
export function buildAnthropicRequest(pdfBase64: string, bestandsnaam: string): AnthropicRequest {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: `Extraheer de bestelling uit "${bestandsnaam}". Antwoord met alleen het JSON-object.` },
        ],
      },
    ],
  }
}

/**
 * Bouwt de Anthropic Messages-request voor een plain-text e-mail.
 * Optioneel een PDF als extra bijlage meegeven.
 */
// Max 4 MB base64 (~3 MB binair) — grotere PDFs worden weggelaten om 400-fouten
// van de Anthropic-API te voorkomen (limiet: 5 MB per document-block).
const MAX_PDF_BASE64_CHARS = 4 * 1024 * 1024

// Max 30 000 tekens voor de e-mailbody — doorgestuurde mails kunnen zeer lang zijn.
const MAX_EMAIL_BODY_CHARS = 30_000

export function buildAnthropicRequestFromEmail(
  emailBody: string,
  emailSubject: string,
  pdfBase64?: string,
): AnthropicRequest {
  const userContent: unknown[] = []

  const safePdf = pdfBase64 && pdfBase64.length <= MAX_PDF_BASE64_CHARS ? pdfBase64 : undefined
  const safeBody = emailBody.length > MAX_EMAIL_BODY_CHARS
    ? emailBody.slice(0, MAX_EMAIL_BODY_CHARS) + '\n[... e-mail ingekort ...]'
    : emailBody

  if (safePdf) {
    userContent.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: safePdf },
    })
  }

  userContent.push({
    type: 'text',
    text: `E-mail onderwerp: ${emailSubject}\n\n--- E-mail tekst ---\n${safeBody}\n\nExtraheer de bestelling uit bovenstaande e-mail${safePdf ? ' (en bijgevoegde PDF)' : ''}. Antwoord met alleen het JSON-object.`,
  })

  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return null
}
function adres(v: unknown): PoAdres | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    naam: str(o.naam), adres: str(o.adres), postcode: str(o.postcode),
    plaats: str(o.plaats), land: str(o.land),
  }
}

/** Pakt de JSON-tekst uit een Anthropic-respons en valideert tegen het schema. */
export function parsePoExtractie(anthropicJson: unknown): PoRuwExtractie {
  if (!anthropicJson || typeof anthropicJson !== 'object') {
    throw new Error('Lege of ongeldige extractie-respons')
  }
  const root = anthropicJson as { content?: Array<{ type?: string; text?: string }> }
  const text = (root.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  else {
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first >= 0 && last > first) raw = raw.slice(first, last + 1)
  }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    throw new Error('Kon de extractie-respons niet als JSON lezen')
  }
  const af = (obj.afzender ?? {}) as Record<string, unknown>
  const regelsIn = Array.isArray(obj.regels) ? obj.regels : []
  return {
    afzender: {
      naam: str(af.naam), email: str(af.email), btw_nummer: str(af.btw_nummer),
      kvk: str(af.kvk), adres: str(af.adres),
    },
    klant_referentie: str(obj.klant_referentie),
    leverdatum_tekst: str(obj.leverdatum_tekst),
    spoed: obj.spoed === true,
    afleveradres: adres(obj.afleveradres),
    factuuradres: adres(obj.factuuradres),
    regels: regelsIn.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      return {
        aantal: num(o.aantal),
        ruwe_omschrijving: str(o.ruwe_omschrijving),
        kwaliteit_tekst: str(o.kwaliteit_tekst),
        kleur_tekst: str(o.kleur_tekst),
        lengte_cm: num(o.lengte_cm),
        breedte_cm: num(o.breedte_cm),
        vorm_tekst: str(o.vorm_tekst),
        klant_artikelnr: str(o.klant_artikelnr),
        prijs: num(o.prijs),
        korting_pct: num(o.korting_pct),
      }
    }),
  }
}
