import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { PerRegelScenario } from '@/modules/planning'

const DEBOUNCE_MS = 350
const STALE_TIME_MS = 30_000

export type OrderVoorstelStatus = 'voorraad' | 'op_inkoop' | 'wacht_op_nieuwe_inkoop'

export interface OrderVoorstelRegel {
  regel_id: string
  artikelnr: string
  gevraagd: number
  beschikbaar_voorraad: number
  op_inkoop: number
  wacht: number
  uitwisselbaar: number
  status: OrderVoorstelStatus
  eerste_io_datum: string | null
  /** Gesimuleerd planning-scenario voor maatwerk-regels; null als niet van toepassing of niet beschikbaar. */
  planning_scenario: PerRegelScenario | null
  /** True als de planning-seam een scenario kon bepalen voor deze maatwerk-regel. */
  planning_beschikbaar: boolean
}

export interface OrderVoorstelResult {
  lever_modus_vraag: boolean
  claim_summary: {
    totaal: number
    voorraad: number
    op_inkoop: number
    uitwisselbaar: number
    wacht: number
  }
  regels: OrderVoorstelRegel[]
}

export interface OrderConceptRegel {
  regel_id: string
  artikelnr: string
  aantal: number
  lengte_cm?: number | null
  breedte_cm?: number | null
  /** Optioneel: kwaliteits-code voor planning-seam; anders afgeleid via artikelnr.split('-')[0]. */
  kwaliteit_code?: string | null
  /** Optioneel: kleur-code voor planning-seam; anders afgeleid via artikelnr.split('-')[1]. */
  kleur_code?: string | null
  /** Optioneel: vorm van het maatwerk-stuk (bijv. 'rechthoek', 'rond', 'ovaal'). */
  vorm?: string | null
  /** Optioneel: afwerking-code (bijv. 'BS', 'ZO', 'ON'). */
  maatwerk_afwerking?: string | null
  /** Optioneel: gewenste leverdatum in ISO-8601 (YYYY-MM-DD). */
  gewenste_leverdatum?: string | null
}

export interface OrderConceptInput {
  debiteur_nr?: number | null
  uitwisselbaar_keuzes?: Array<{ regel_id: string; artikelnr: string; aantal: number }>
  regels: OrderConceptRegel[]
}

function conceptHash(concept: OrderConceptInput): string {
  return JSON.stringify({
    debiteur_nr: concept.debiteur_nr ?? null,
    uitwisselbaar_keuzes: concept.uitwisselbaar_keuzes ?? [],
    regels: concept.regels.map((r) => ({
      regel_id: r.regel_id,
      artikelnr: r.artikelnr,
      aantal: r.aantal,
      lengte_cm: r.lengte_cm ?? null,
      breedte_cm: r.breedte_cm ?? null,
      kwaliteit_code: r.kwaliteit_code ?? null,
      kleur_code: r.kleur_code ?? null,
      vorm: r.vorm ?? null,
      maatwerk_afwerking: r.maatwerk_afwerking ?? null,
      gewenste_leverdatum: r.gewenste_leverdatum ?? null,
    })),
  })
}

function hasVulledRegels(concept: OrderConceptInput): boolean {
  return concept.regels.some((r) => r.artikelnr && r.aantal > 0)
}

export function useOrderVoorstel(concept: OrderConceptInput | null) {
  const enabled = concept !== null && hasVulledRegels(concept)
  const hash = concept !== null ? conceptHash(concept) : null

  const [debounced, setDebounced] = useState<string | null>(enabled ? hash : null)

  useEffect(() => {
    if (!enabled) {
      setDebounced(null)
      return
    }
    const t = setTimeout(() => setDebounced(hash), DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, enabled])

  return useQuery<OrderVoorstelResult, Error>({
    queryKey: ['order-voorstel', debounced],
    queryFn: async (): Promise<OrderVoorstelResult> => {
      if (!concept) throw new Error('concept niet beschikbaar')

      const { data, error } = await supabase.functions.invoke<OrderVoorstelResult>(
        'orders-bouw-voorstel',
        { body: { concept } },
      )

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Geen data ontvangen van orders-bouw-voorstel')

      return data
    },
    enabled: debounced !== null,
    staleTime: STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
