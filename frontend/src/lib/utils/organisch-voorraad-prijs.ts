import { supabase } from '@/lib/supabase/client'

/**
 * Voor voorraadproducten met "ORGANISCH" in de naam (bv. artikelnr 771150045
 * "CISCO 15 CA: 240x340 cm ORGANISCH") wordt geen verkoopprijs in producten
 * gevuld. Deze helper berekent on-the-fly de prijs uit:
 *
 *   oppervlak (uit naam-parse "240x340 cm") × maatwerk_m2_prijzen.verkoopprijs_m2
 *   + maatwerk_vormen.toeslag voor 'organisch_a' (€75 na mig 179)
 *
 * Returnt null als data ontbreekt (geen maten in naam, geen m²-prijs, geen
 * kwaliteit/kleur). Caller moet dan de bestaande fallback respecteren.
 */
export async function berekenOrganischVoorraadPrijs(
  omschrijving: string,
  kwaliteitCode: string | null | undefined,
  kleurCode: string | null | undefined,
): Promise<number | null> {
  if (!kwaliteitCode || !kleurCode) return null

  // Parse "240x340 cm" of "240 x 340 cm" uit omschrijving (case-insensitive)
  const match = omschrijving.match(/(\d+)\s*x\s*(\d+)\s*cm/i)
  if (!match) return null
  const lengteCm = Number(match[1])
  const breedteCm = Number(match[2])
  if (!lengteCm || !breedteCm) return null
  const oppervlakM2 = (lengteCm * breedteCm) / 10000

  // m²-prijs uit prijslijst voor kwaliteit + kleur (probeer beide kleur-formats: '15' en '15.0')
  const normKleur = kleurCode.replace(/\.0$/, '')
  let m2Prijs: number | null = null
  for (const kc of Array.from(new Set([kleurCode, normKleur]))) {
    const { data } = await supabase
      .from('maatwerk_m2_prijzen')
      .select('verkoopprijs_m2')
      .eq('kwaliteit_code', kwaliteitCode)
      .eq('kleur_code', kc)
      .maybeSingle()
    if (data?.verkoopprijs_m2) { m2Prijs = data.verkoopprijs_m2; break }
  }
  if (!m2Prijs) return null

  // Vorm-toeslag (€75 voor organisch_a na mig 179)
  const { data: vormRow } = await supabase
    .from('maatwerk_vormen')
    .select('toeslag')
    .eq('code', 'organisch_a')
    .maybeSingle()
  const toeslag = Number(vormRow?.toeslag ?? 75)

  const prijs = oppervlakM2 * m2Prijs + toeslag
  return Math.round(prijs * 100) / 100
}
