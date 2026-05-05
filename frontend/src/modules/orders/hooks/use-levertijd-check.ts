import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { simuleerLevertijd } from '@/modules/planning'
import type { MaatwerkRegelConcept, PerRegelScenario, SeamResult } from '@/modules/planning'

const DEBOUNCE_MS = 350
const STALE_TIME_MS = 60_000

// Intern regel-ID voor de single-rule seam-aanroep vanuit deze hook.
const SINGLE_RULE_ID = '__levertijd_check__'

export interface UseLevertijdCheckArgs {
  kwaliteitCode?: string | null
  kleurCode?: string | null
  lengteCm?: number | null
  breedteCm?: number | null
  vorm?: string | null
  gewensteLeverdatum?: string | null
  debiteurNr?: number | null
  enabled?: boolean
}

interface DebouncedArgs {
  kwaliteit: string
  kleur: string
  lengte: number
  breedte: number
  vorm?: string | null
  gewensteLeverdatum?: string | null
  debiteurNr?: number | null
}

function isReady(args: UseLevertijdCheckArgs): DebouncedArgs | null {
  if (!args.kwaliteitCode || !args.kleurCode) return null
  if (!args.lengteCm || !args.breedteCm) return null
  if (args.lengteCm <= 0 || args.breedteCm <= 0) return null
  return {
    kwaliteit: args.kwaliteitCode,
    kleur: args.kleurCode,
    lengte: args.lengteCm,
    breedte: args.breedteCm,
    vorm: args.vorm ?? null,
    gewensteLeverdatum: args.gewensteLeverdatum ?? null,
    debiteurNr: args.debiteurNr ?? null,
  }
}

/** Resultaat van één levertijd-check via de planning-seam. */
export interface LevertijdCheckResult {
  seamResult: SeamResult
  /** Handig short-cut: het eerste scenario (of null als niet beschikbaar). */
  scenario: PerRegelScenario | null
}

export function useLevertijdCheck(args: UseLevertijdCheckArgs) {
  const ready = isReady(args)
  const [debounced, setDebounced] = useState<DebouncedArgs | null>(ready)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(ready), DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready?.kwaliteit,
    ready?.kleur,
    ready?.lengte,
    ready?.breedte,
    ready?.vorm,
    ready?.gewensteLeverdatum,
    ready?.debiteurNr,
  ])

  return useQuery<LevertijdCheckResult, Error>({
    queryKey: ['levertijd-check', debounced],
    queryFn: async (): Promise<LevertijdCheckResult> => {
      if (!debounced) throw new Error('args niet klaar')

      const regel: MaatwerkRegelConcept = {
        regel_id: SINGLE_RULE_ID,
        kwaliteit_code: debounced.kwaliteit,
        kleur_code: debounced.kleur,
        lengte_cm: debounced.lengte,
        breedte_cm: debounced.breedte,
        ...(debounced.vorm ? { vorm: debounced.vorm } : {}),
        ...(debounced.gewensteLeverdatum
          ? { gewenste_leverdatum: debounced.gewensteLeverdatum }
          : {}),
        ...(debounced.debiteurNr != null ? { debiteur_nr: debounced.debiteurNr } : {}),
      }

      const seamResult = await simuleerLevertijd([regel])
      const scenario =
        seamResult.ok && seamResult.scenarios.length > 0
          ? seamResult.scenarios[0]
          : null

      return { seamResult, scenario }
    },
    enabled: debounced !== null && (args.enabled ?? true),
    staleTime: STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
