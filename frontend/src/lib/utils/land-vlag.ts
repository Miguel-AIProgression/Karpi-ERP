// Land-string → ISO-2 + vlag-emoji.
//
// Karpi's afleveradressen slaan `land` op als ISO-2-code ('NL', 'BE', 'DE', …)
// maar legacy-data en handmatige invoer kunnen volledige landnamen bevatten
// ('Nederland', 'Belgium', 'Frankrijk', …). Deze util normaliseert beide naar
// een ISO-2-code en levert het bijbehorende vlag-emoji (regional-indicator).

const NAAM_NAAR_ISO2: Record<string, string> = {
  NEDERLAND: 'NL',
  HOLLAND: 'NL',
  NETHERLANDS: 'NL',
  BELGIE: 'BE',
  BELGIUM: 'BE',
  DUITSLAND: 'DE',
  GERMANY: 'DE',
  DEUTSCHLAND: 'DE',
  FRANKRIJK: 'FR',
  FRANCE: 'FR',
  LUXEMBURG: 'LU',
  LUXEMBOURG: 'LU',
  OOSTENRIJK: 'AT',
  AUSTRIA: 'AT',
  ZWITSERLAND: 'CH',
  SWITZERLAND: 'CH',
  ITALIE: 'IT',
  ITALY: 'IT',
  SPANJE: 'ES',
  SPAIN: 'ES',
  POLEN: 'PL',
  POLAND: 'PL',
  TSJECHIE: 'CZ',
  DENEMARKEN: 'DK',
  DENMARK: 'DK',
  ZWEDEN: 'SE',
  SWEDEN: 'SE',
  NOORWEGEN: 'NO',
  NORWAY: 'NO',
  ENGELAND: 'GB',
  GROOTBRITTANNIE: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
}

/** Vraag de ISO-2-code op voor `land`. Geeft null bij onbekende waarde. */
export function landNaarIso2(land: string | null | undefined): string | null {
  if (!land) return null
  const trimmed = land.trim()
  if (!trimmed) return null

  if (trimmed.length === 2 && /^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  // Diakritieken strippen ("BELGIË" → "BELGIE") zodat invoer-varianten matchen.
  const key = trimmed
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return NAAM_NAAR_ISO2[key] ?? null
}

/** Render een ISO-2-code als regional-indicator vlag-emoji. */
export function iso2NaarVlag(iso2: string | null): string | null {
  if (!iso2 || iso2.length !== 2) return null
  const A = 0x41
  const REGIONAL_A = 0x1f1e6
  const code1 = iso2.charCodeAt(0) - A + REGIONAL_A
  const code2 = iso2.charCodeAt(1) - A + REGIONAL_A
  return String.fromCodePoint(code1, code2)
}

/** Combinatie: land-string → vlag-emoji (of null als onbekend). */
export function landNaarVlag(land: string | null | undefined): string | null {
  return iso2NaarVlag(landNaarIso2(land))
}

// Reverse-mapping voor weergave: ISO-2 → Nederlandse landnaam. Beperkte set
// rondom Karpi's afzetgebied (NL/BE + buurlanden). Onbekende codes worden door
// callers teruggevallen op de raw code.
const ISO2_NAAR_NAAM_NL: Record<string, string> = {
  NL: 'Nederland',
  BE: 'België',
  DE: 'Duitsland',
  FR: 'Frankrijk',
  LU: 'Luxemburg',
  AT: 'Oostenrijk',
  CH: 'Zwitserland',
  IT: 'Italië',
  ES: 'Spanje',
  PL: 'Polen',
  CZ: 'Tsjechië',
  DK: 'Denemarken',
  SE: 'Zweden',
  NO: 'Noorwegen',
  GB: 'Verenigd Koninkrijk',
}

export function iso2NaarNaam(iso2: string | null | undefined): string | null {
  if (!iso2) return null
  return ISO2_NAAR_NAAM_NL[iso2.toUpperCase()] ?? null
}
