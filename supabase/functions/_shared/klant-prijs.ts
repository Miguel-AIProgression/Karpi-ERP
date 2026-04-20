// Haal de *klant*-prijs op voor een webshop-orderregel.
//
// Floorpassion is de debiteur die de order bij Karpi plaatst; de prijzen die
// Lightspeed meestuurt zijn consumentenprijzen en mogen NOOIT in de order
// landen. De daadwerkelijke prijs komt uit `prijslijst_regels` via
// `debiteuren.prijslijst_nr`.
//
// Prijs-semantiek:
//   - standaard artikel  → prijslijst-prijs is per stuk → prijs = prijslijst
//   - maatwerk           → prijslijst-prijs is per m²   → prijs = m² × prijslijst
//
// Oppervlak volgt Karpi-conventie (zie frontend/src/lib/utils/maatwerk-prijs.ts):
//   - rond: diameter² / 10000 (omsluitend vierkant; dims zijn dan al gelijk)
//   - anders: lengte × breedte / 10000

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface KlantPrijsResult {
  prijs: number | null
  bron: 'prijslijst' | 'prijslijst_m2' | 'verkoopprijs' | 'geen'
  prijslijst_nr?: string | null
}

export async function haalKlantPrijs(
  supabase: SupabaseClient,
  debiteurNr: number,
  artikelnr: string | null,
  opts: { is_maatwerk?: boolean; lengte_cm?: number | null; breedte_cm?: number | null } = {},
): Promise<KlantPrijsResult> {
  if (!artikelnr) return { prijs: null, bron: 'geen' }

  // 1) Prijslijst van de debiteur
  const { data: deb } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  const prijslijstNr = deb?.prijslijst_nr ?? null

  if (prijslijstNr) {
    const { data: regel } = await supabase
      .from('prijslijst_regels')
      .select('prijs')
      .eq('prijslijst_nr', prijslijstNr)
      .eq('artikelnr', artikelnr)
      .maybeSingle()
    const basis = regel?.prijs != null ? Number(regel.prijs) : null
    if (basis != null && Number.isFinite(basis)) {
      if (opts.is_maatwerk) {
        const oppervlak = berekenOppervlakM2(opts.lengte_cm ?? null, opts.breedte_cm ?? null)
        if (oppervlak > 0) {
          return {
            prijs: Math.round(basis * oppervlak * 100) / 100,
            bron: 'prijslijst_m2',
            prijslijst_nr: prijslijstNr,
          }
        }
        // Maatwerk zonder dims: bewaar m²-basis zodat de order wordt
        // aangemaakt; UI toont dat dims ontbreken. Beter dan consumentprijs.
        return { prijs: basis, bron: 'prijslijst_m2', prijslijst_nr: prijslijstNr }
      }
      return { prijs: basis, bron: 'prijslijst', prijslijst_nr: prijslijstNr }
    }
  }

  // 2) Fallback: verkoopprijs van het product
  const { data: prod } = await supabase
    .from('producten')
    .select('verkoopprijs')
    .eq('artikelnr', artikelnr)
    .maybeSingle()
  if (prod?.verkoopprijs != null) {
    return { prijs: Number(prod.verkoopprijs), bron: 'verkoopprijs' }
  }
  return { prijs: null, bron: 'geen' }
}

function berekenOppervlakM2(lengte: number | null, breedte: number | null): number {
  if (!lengte || !breedte || lengte <= 0 || breedte <= 0) return 0
  return (lengte * breedte) / 10000
}
