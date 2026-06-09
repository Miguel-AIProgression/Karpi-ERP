// Frontend-spiegel van de pre-flight validator. Bewust een KOPIE (niet een import)
// van supabase/functions/_shared/vervoerder-eisen.ts: Deno-edge-modules zijn niet
// door Vite importeerbaar (https-imports, .ts-extensies). Patroon = de seam
// _shared/debiteur-matcher.ts ↔ frontend product-matcher: dezelfde pure logica aan
// beide kanten, zodat de UI-waarschuwing en de edge-poort identiek oordelen.
//
// Houd deze in sync met de _shared-bron bij elke wijziging aan de HST-eisen.

export interface VerzendContext {
  vervoerder_code: string
  afl_land: string | null
  afl_telefoon: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
}

export interface VerzendProbleem {
  code: 'TELEFOON_ONTBREEKT' | 'ADRESVELD_LEEG' | 'ADRES_ONSPLITSBAAR' | 'LAND_BUITEN_BEREIK'
  veld: string
  melding: string
}

export interface VerzendValidatie {
  ok: boolean
  problemen: VerzendProbleem[]
}

// HST bedient in V1 alleen NL. Spiegelt HST_LANDEN_BEREIK uit de _shared-bron.
export const HST_LANDEN_BEREIK = ['NL']

function leeg(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0
}

function telefoonGeldig(tel: string | null | undefined): boolean {
  if (leeg(tel)) return false
  const cijfers = (tel as string).replace(/\D/g, '')
  return cijfers.length >= 10 && cijfers.length <= 15
}

export function valideerVoorVervoerder(ctx: VerzendContext): VerzendValidatie {
  const problemen: VerzendProbleem[] = []

  // V1: alleen HST heeft eisen. Andere vervoerders → geen pre-flight (ok).
  if (ctx.vervoerder_code !== 'hst_api') {
    return { ok: true, problemen }
  }

  if (!telefoonGeldig(ctx.afl_telefoon)) {
    problemen.push({
      code: 'TELEFOON_ONTBREEKT',
      veld: 'afl_telefoon',
      melding: 'Telefoonnummer (10–15 cijfers) ontbreekt — HST belt vóór aflevering.',
    })
  }

  if (leeg(ctx.afl_naam) || leeg(ctx.afl_adres) || leeg(ctx.afl_postcode) || leeg(ctx.afl_plaats)) {
    problemen.push({
      code: 'ADRESVELD_LEEG',
      veld: 'afl_adres',
      melding: 'Naam, adres, postcode of plaats is leeg.',
    })
  }

  const land = (ctx.afl_land ?? '').trim().toUpperCase()
  if (!HST_LANDEN_BEREIK.includes(land)) {
    problemen.push({
      code: 'LAND_BUITEN_BEREIK',
      veld: 'afl_land',
      melding: `HST bedient ${land || '(leeg)'} niet — kies handmatig een vervoerder.`,
    })
  }

  return { ok: problemen.length === 0, problemen }
}
