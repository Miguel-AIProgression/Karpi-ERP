// Voorgestelde-bundel-fetcher: leest de SQL-view `voorgestelde_zending_bundels`
// (mig 229) — bron-van-waarheid voor de live preview van zending-bundels in
// Pick & Ship vóór een pickronde is gestart. View groepeert open orders op de
// 4D bundel-sleutel (debiteur × adres-norm × effectieve vervoerder × week).
//
// Geen state, geen invalidatie nodig vanuit DB-kant: de view herevalueert per
// query. Wel invalidatie via React Query bij mutaties (vervoerder-override,
// afleverdatum-wijziging, pickronde-start). Zie de invalidate-aanroepen in:
//   · `vervoerder-orderregel-pill.tsx`
//   · `order-form.tsx` (afleverdatum-mutation)
//   · `use-zendingen.ts` (useStartPickrondes onSuccess, mig 248)

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

/**
 * 1 rij van `voorgestelde_zending_bundels` — alle aggregaties die de view
 * teruggeeft. Bedragen zijn NUMERIC in DB; we typen ze als `number` na conversie.
 */
export interface VoorgesteldeBundel {
  /** Stabiele identiteit, formaat 'D{deb}|V{vervoerder}|W{week}|A{adres}'. */
  sleutel: string
  debiteur_nr: number
  debiteur_naam: string
  /** Genormaliseerd afleveradres (postcode|adres|land, alle uppercase). */
  adres_norm: string
  /** Snippets voor weergave (eerste order van groep — alle orders in groep
   *  hebben hetzelfde adres want bundel-sleutel garandeert dat). */
  afl_naam: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  /** Effectieve vervoerder-code, of 'AFHAAL' / 'GEEN'. */
  vervoerder_code: string
  is_afhalen: boolean
  /** ISO-week, formaat 'YYYY-Www'. */
  jaar_week: string
  /** Order-IDs in deze bundel, gesorteerd. */
  order_ids: number[]
  aantal_orders: number
  /** Subtotaal exclusief BTW (€), som van order_regels.bedrag minus VERZEND. */
  bundel_subtotaal_excl: number
  /** Klant-config-snapshot, voor UI-tooltip. */
  klant_verzendkosten: number
  klant_drempel: number | null
  gratis_verzending: boolean
  /** TRUE = bundel-totaal haalt drempel of klant heeft gratis verzending. */
  drempel_gehaald: boolean
  /** Wat de klant zou betalen als deze bundel nu zou worden gefactureerd. */
  te_betalen_verzendkosten: number
  /** Geschat verschil met "elke order solo". 0 voor 1-order bundels. */
  bundel_besparing: number
}

/** Ruwe DB-rij — alle numerics komen als string of number, normaliseren we hier. */
interface VoorgesteldeBundelRaw {
  sleutel: string
  debiteur_nr: number
  debiteur_naam: string | null
  adres_norm: string
  afl_naam: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  vervoerder_code: string
  is_afhalen: boolean
  jaar_week: string
  order_ids: number[] | null
  aantal_orders: number
  bundel_subtotaal_excl: number | string
  klant_verzendkosten: number | string | null
  klant_drempel: number | string | null
  gratis_verzending: boolean
  drempel_gehaald: boolean
  te_betalen_verzendkosten: number | string
  bundel_besparing: number | string
}

function num(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function mapRow(r: VoorgesteldeBundelRaw): VoorgesteldeBundel {
  return {
    sleutel: r.sleutel,
    debiteur_nr: r.debiteur_nr,
    debiteur_naam: r.debiteur_naam ?? '—',
    adres_norm: r.adres_norm,
    afl_naam: r.afl_naam,
    afl_postcode: r.afl_postcode,
    afl_plaats: r.afl_plaats,
    vervoerder_code: r.vervoerder_code,
    is_afhalen: r.is_afhalen,
    jaar_week: r.jaar_week,
    order_ids: r.order_ids ?? [],
    aantal_orders: r.aantal_orders,
    bundel_subtotaal_excl: num(r.bundel_subtotaal_excl),
    klant_verzendkosten: num(r.klant_verzendkosten),
    klant_drempel: r.klant_drempel == null ? null : num(r.klant_drempel),
    gratis_verzending: r.gratis_verzending,
    drempel_gehaald: r.drempel_gehaald,
    te_betalen_verzendkosten: num(r.te_betalen_verzendkosten),
    bundel_besparing: num(r.bundel_besparing),
  }
}

/**
 * Fetcher voor de voorgestelde-bundel-view.
 *
 * @param jaarWeek Optioneel ISO-week filter ('YYYY-Www'). Zonder filter:
 *                 alle weken. De Pick & Ship pagina rendert per week-sectie
 *                 dus filtert in-memory; voor tooltip/details kan deze
 *                 fetcher per week worden aangeroepen.
 */
export async function fetchVoorgesteldeBundels(
  jaarWeek?: string,
): Promise<VoorgesteldeBundel[]> {
  let q = supabase.from('voorgestelde_zending_bundels').select('*')
  if (jaarWeek) q = q.eq('jaar_week', jaarWeek)
  const { data, error } = await q.order('jaar_week', { ascending: true })
    .order('debiteur_nr', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => mapRow(r as VoorgesteldeBundelRaw))
}

const STALE_60_SEC = 60 * 1000

export function useVoorgesteldeBundels(
  jaarWeek?: string,
  options?: Omit<UseQueryOptions<VoorgesteldeBundel[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<VoorgesteldeBundel[]>({
    queryKey: ['voorgestelde-bundels', jaarWeek ?? 'all'],
    queryFn: () => fetchVoorgesteldeBundels(jaarWeek),
    staleTime: STALE_60_SEC,
    ...options,
  })
}

/**
 * Filter "echte bundels" (≥2 orders) uit een lijst — de UI toont alleen die
 * als kaart, want 1-order "bundels" zijn gewoon solo-orders die elders al
 * in de KlantClusterBlok zichtbaar zijn.
 */
export function alleenEchteBundels(bundels: VoorgesteldeBundel[]): VoorgesteldeBundel[] {
  return bundels.filter((b) => b.aantal_orders >= 2)
}
