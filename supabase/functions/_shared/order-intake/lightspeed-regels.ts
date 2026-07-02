// Gededupliceerde Lightspeed-regelbouw voor BEIDE Lightspeed-intake-paden
// (sync-webshop-order webhook + import-lightspeed-orders cron-poll). Vóór deze
// module hadden beide een eigen buildRegels die uiteenliepen op gewicht-conversie
// (factor 1000, nu opgelost in slice 0), maatwerk_vorm (alleen de cron zette het)
// en omschrijving-opbouw. Eén bron van waarheid.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseMaatwerkDims, type OrderMatcherRow } from '../order-matcher.ts'
import { matchProduct, buildOmschrijving, type ProductMatch } from '../product-matcher.ts'
import { regelBedrag } from './regel-bedrag.ts'
import { haalKlantPrijs } from '../klant-prijs.ts'
import { kgVanLightspeedGewicht } from './gewicht.ts'
import type { IntakeRegel } from './types.ts'
import { createIntakeCache } from './intake-cache.ts'

/** Pure assemblage van één IntakeRegel uit reeds-bepaalde match + prijs + dims. */
export function toIntakeRegel(input: {
  omschrijving: string
  omschrijving_2: string | null
  aantal: number
  prijs: number | null
  gewicht_kg: number | null
  match: ProductMatch
  dims: { lengte: number; breedte: number } | null
}): IntakeRegel {
  const { match, aantal, prijs } = input
  const bedrag = regelBedrag(prijs, aantal)
  return {
    artikelnr: match.artikelnr,
    omschrijving: input.omschrijving,
    omschrijving_2: input.omschrijving_2,
    orderaantal: aantal,
    te_leveren: aantal,
    prijs,
    korting_pct: 0,
    bedrag,
    gewicht_kg: input.gewicht_kg,
    is_maatwerk: match.is_maatwerk ?? false,
    maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
    maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
    maatwerk_vorm: match.maatwerk_vorm ?? null,
    maatwerk_lengte_cm: input.dims?.lengte ?? null,
    maatwerk_breedte_cm: input.dims?.breedte ?? null,
  }
}

/** Bouwt de IntakeRegels voor een Lightspeed-order (beide paden delen dit). */
export async function buildLightspeedRegels(
  supabase: SupabaseClient,
  rows: OrderMatcherRow[],
  debiteurNr: number,
): Promise<{ regels: IntakeRegel[]; matched: number; unmatched: number }> {
  const regels: IntakeRegel[] = []
  let matched = 0
  let unmatched = 0

  // Perf (N+1-fix, perf/n1-intake-allocator): prijslijst_nr één keer per
  // order-run ophalen i.p.v. per regel opnieuw binnen haalKlantPrijs, en een
  // gedeelde memo-cache (klanteigen_namen) door de matcher-loop heen geven.
  const { data: debRow, error: debError } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (debError) {
    // Geldt voor de hele order (was per regel binnen haalKlantPrijs) —
    // een fout hier schakelt prijslijst-pricing uit voor álle regels.
    console.error(`buildLightspeedRegels: debiteuren-fetch gefaald voor ${debiteurNr}: ${debError.message}`)
  }
  const prijslijstNr: string | null = debRow?.prijslijst_nr ?? null
  const cache = createIntakeCache()

  for (const row of rows) {
    const match = await matchProduct(supabase, row, debiteurNr, cache)
    // Staaltjes (Gratis Muster) worden niet ingeladen — Karpi factureert ze niet.
    if (match.unmatchedReden === 'muster') continue

    if (match.artikelnr || match.is_maatwerk) matched++
    else unmatched++

    const dims = match.is_maatwerk ? parseMaatwerkDims(row) : null
    const aantal = row.quantityOrdered ?? 1
    // vorm-maatwerk: artikelnr-koppeling (mig 353) mag geen auto-pricing
    // activeren — TS-prijspad kent geen vormtoeslag; operator prijst
    // (zie €0,00-orders-werkitem).
    const klantPrijs: { prijs: number | null } = match.is_maatwerk && match.maatwerk_vorm
      ? { prijs: null }
      : await haalKlantPrijs(supabase, debiteurNr, match.artikelnr, {
          is_maatwerk: match.is_maatwerk,
          lengte_cm: dims?.lengte ?? null,
          breedte_cm: dims?.breedte ?? null,
          prijslijstNr,
        })

    regels.push(
      toIntakeRegel({
        omschrijving: buildOmschrijving(row, match),
        omschrijving_2: row.variantTitle ?? null,
        aantal,
        prijs: klantPrijs.prijs,
        gewicht_kg: kgVanLightspeedGewicht(row.weight),
        match,
        dims: dims ?? null,
      }),
    )
  }

  return { regels, matched, unmatched }
}
