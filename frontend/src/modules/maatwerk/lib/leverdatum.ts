// Helper voor het berekenen van de maatwerk-afleverdatum bij een split-order
// (deelleveringen=ja, gemengd voorraad+maatwerk).
//
// Probleem (issue #33): de statische `berekenAfleverdatum` rekent met een
// `maatwerk_weken`-config (default 4, klant override mogelijk 1) en levert
// daardoor een misleidende leverdatum als de echte capaciteits-/snijplan-
// situatie 15 weken zou zijn.
//
// Deze helper roept de echte planning-seam (`check-levertijd` edge function)
// aan voor élke maatwerk-regel waarvan kwaliteit + kleur + afmetingen
// compleet zijn, en retourneert de **maximale** lever_datum. Voor regels
// zonder complete data (bv. afmetingen nog niet ingevuld) valt hij terug op
// de meegegeven statische `fallbackDatum` zodat de form-submit niet blokkeert.

import { checkLevertijd } from '@/lib/supabase/queries/levertijd'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

interface Args {
  maatwerkRegels: OrderRegelFormData[]
  debiteurNr: number | null
  fallbackDatum: string | null
  gewensteLeverdatum?: string | null
}

export async function berekenMaatwerkAfleverdatumViaSeam({
  maatwerkRegels,
  debiteurNr,
  fallbackDatum,
  gewensteLeverdatum,
}: Args): Promise<string | null> {
  const completeRegels = maatwerkRegels.filter(
    (r) =>
      r.maatwerk_kwaliteit_code &&
      r.maatwerk_kleur_code &&
      r.maatwerk_lengte_cm &&
      r.maatwerk_breedte_cm &&
      r.maatwerk_lengte_cm > 0 &&
      r.maatwerk_breedte_cm > 0,
  )

  if (completeRegels.length === 0) return fallbackDatum

  const checks = await Promise.allSettled(
    completeRegels.map((r) =>
      checkLevertijd({
        kwaliteit_code: r.maatwerk_kwaliteit_code!,
        kleur_code: r.maatwerk_kleur_code!,
        lengte_cm: r.maatwerk_lengte_cm!,
        breedte_cm: r.maatwerk_breedte_cm!,
        ...(r.maatwerk_vorm ? { vorm: r.maatwerk_vorm } : {}),
        ...(gewensteLeverdatum ? { gewenste_leverdatum: gewensteLeverdatum } : {}),
        ...(debiteurNr != null ? { debiteur_nr: debiteurNr } : {}),
      }),
    ),
  )

  const datums = checks
    .map((c) => (c.status === 'fulfilled' ? c.value.lever_datum : null))
    .filter((d): d is string => !!d)

  if (datums.length === 0) return fallbackDatum

  const maxDatum = datums.reduce((acc, d) => (d > acc ? d : acc))
  if (!fallbackDatum) return maxDatum
  return maxDatum > fallbackDatum ? maxDatum : fallbackDatum
}
