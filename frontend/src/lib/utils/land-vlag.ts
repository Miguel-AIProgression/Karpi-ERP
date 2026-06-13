// Land-string → ISO-2 + vlag-emoji.
//
// Karpi's afleveradressen slaan `land` op als ISO-2-code ('NL', 'BE', 'DE', …)
// maar legacy-data en handmatige invoer kunnen volledige landnamen bevatten
// ('Nederland', 'Belgium', 'Frankrijk', …). De naam→ISO-2-mapping leeft in de
// gedeelde seam supabase/functions/_shared/adres-split.ts (ADR-0033) — één bron
// voor edge (vrachtbrief/EDI) én frontend. Hier alleen de frontend-only vlag-
// rendering en de reverse ISO-2→naam-weergave.

// Strikte variant (onbekend → null) — exact het oude null-contract dat de
// vlag-logica hieronder nodig heeft.
export { landNaarIso2Strikt as landNaarIso2 } from '../../../../supabase/functions/_shared/adres-split'
import { landNaarIso2Strikt } from '../../../../supabase/functions/_shared/adres-split'

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
  return iso2NaarVlag(landNaarIso2Strikt(land))
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
