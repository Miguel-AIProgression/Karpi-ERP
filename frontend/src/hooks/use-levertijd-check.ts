// DEPRECATED — gebruik `useFitCheck` uit `@/modules/levertijd` (ADR-0020, stap 4
// van het Levertijd-Module-implementatieplan).
//
// Deze hook bestaat in twee gedaantes:
//
//   1. De originele `useLevertijdCheck` — wrapt de `check-levertijd` edge
//      function (kwaliteit/kleur/lengte/breedte/gewenste leverdatum) en wordt
//      nog door `LevertijdSuggestie` gebruikt. Eén release back-compat;
//      verdwijnt bij stap 6/7 van het plan zodra het order-form pad over is
//      op de Module's RPC's (`levertijd_fit_check` + `levertijd_snelste_haalbaar`).
//
//   2. Een re-export van `useFitCheck` uit `@/modules/levertijd` voor
//      migrerende callers. Geeft de nieuwe Module-API onder de oude file-naam
//      zodat search-and-replace per import-pad kan plaatsvinden.
//
// Nieuw werk: importeer rechtstreeks uit `@/modules/levertijd`.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkLevertijd } from '@/lib/supabase/queries/levertijd'
import type { CheckLevertijdRequest, CheckLevertijdResponse } from '@/lib/supabase/queries/levertijd'

/**
 * @deprecated Gebruik `useFitCheck` uit `@/modules/levertijd` (ADR-0020).
 *             Re-export voor migrerende callers — wijst naar de Module-API
 *             rond `levertijd_fit_check` (mig 277).
 */
export { useFitCheck } from '@/modules/levertijd'

const DEBOUNCE_MS = 350
const STALE_TIME_MS = 60_000

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

/**
 * @deprecated Gebruik `useFitCheck` uit `@/modules/levertijd` (ADR-0020 +
 *             plan stap 4). Deze hook blijft tijdelijk werken voor
 *             `LevertijdSuggestie` — wordt opgeruimd in stap 6/7 zodra het
 *             order-form pad over is op de SQL-RPC's `levertijd_fit_check`
 *             en `levertijd_snelste_haalbaar` (mig 277).
 */
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

  return useQuery<CheckLevertijdResponse, Error>({
    queryKey: ['levertijd-check', debounced],
    queryFn: () => {
      if (!debounced) throw new Error('args niet klaar')
      const req: CheckLevertijdRequest = {
        kwaliteit_code: debounced.kwaliteit,
        kleur_code: debounced.kleur,
        lengte_cm: debounced.lengte,
        breedte_cm: debounced.breedte,
        ...(debounced.vorm ? { vorm: debounced.vorm } : {}),
        ...(debounced.gewensteLeverdatum ? { gewenste_leverdatum: debounced.gewensteLeverdatum } : {}),
        ...(debounced.debiteurNr != null ? { debiteur_nr: debounced.debiteurNr } : {}),
      }
      return checkLevertijd(req)
    },
    enabled: debounced !== null && (args.enabled ?? true),
    staleTime: STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
